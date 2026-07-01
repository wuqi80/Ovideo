#!/usr/bin/env python3
"""
ComfyUI Agent - Deploy on GPU servers.
Polls backend for tasks, executes them on local ComfyUI instances, reports results.

Usage: python comfyui_agent.py --server URL --token TOKEN --ports 8188,8189
"""
import argparse
import json
import logging
import os
import platform
import signal
import subprocess
import sys
import time
import requests
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger("comfyui-agent")

POLL_INTERVAL = 3
HEARTBEAT_INTERVAL = 3
AGENT_VERSION = "2026-07-01-qwen-diagnostics-v2"


class ComfyUIAgent:
    def __init__(self, server_url: str, token: str, ports: list):
        self.server_url = server_url.rstrip("/")
        self.token = token
        self.ports = ports
        self.agent_id = None
        self.running = True
        self.current_tasks = 0
        signal.signal(signal.SIGTERM, self._shutdown)
        signal.signal(signal.SIGINT, self._shutdown)

    def _shutdown(self, *args):
        logger.info("Shutting down gracefully...")
        self.running = False

    def _headers(self):
        return {"Authorization": f"Bearer {self.token}"}

    def _get_system_info(self):
        info = {
            "hostname": platform.node(),
            "os": platform.system(),
            "agent_version": AGENT_VERSION,
        }
        try:
            result = subprocess.run(
                ["nvidia-smi", "--query-gpu=name,memory.total",
                 "--format=csv,noheader"],
                capture_output=True, text=True, timeout=10
            )
            if result.returncode == 0:
                info["gpus"] = [line.strip() for line in result.stdout.strip().split("\n") if line.strip()]
        except Exception:
            info["gpus"] = []
        return info

    def _check_comfyui(self, port: int) -> str:
        try:
            resp = requests.get(f"http://127.0.0.1:{port}/system_stats", timeout=5)
            return "healthy" if resp.status_code == 200 else "unhealthy"
        except Exception:
            return "offline"

    def register(self):
        logger.info(f"Registering with {self.server_url}...")
        resp = requests.post(
            f"{self.server_url}/api/agent/register",
            json={
                "system_info": self._get_system_info(),
                "comfyui_ports": self.ports,
            },
            headers=self._headers(),
            timeout=15
        )
        resp.raise_for_status()
        data = resp.json()
        if not data.get("success"):
            raise RuntimeError(f"Registration failed: {data}")
        self.agent_id = data["agent_id"]
        logger.info(f"Registered as {self.agent_id} ({data.get('name', '')})")
        logger.info(f"  ComfyUI ports: {self.ports}")

    def heartbeat(self):
        instances = [{"port": p, "status": self._check_comfyui(p)} for p in self.ports]
        try:
            requests.post(
                f"{self.server_url}/api/agent/heartbeat",
                json={
                    "agent_id": self.agent_id,
                    "comfyui_instances": instances,
                    "system_info": self._get_system_info(),
                    "current_tasks": self.current_tasks,
                },
                headers=self._headers(),
                timeout=10
            )
        except Exception as e:
            logger.warning(f"Heartbeat failed: {e}")

    def poll(self):
        resp = requests.get(
            f"{self.server_url}/api/agent/poll",
            headers=self._headers(),
            timeout=10
        )
        resp.raise_for_status()
        data = resp.json()
        task = data.get("task")
        if task:
            logger.info(f"poll: Got task {task.get('task_id')} (type={task.get('task_type')})")
        return task

    def execute_comfyui_task(self, task):
        port = self._pick_healthy_port()
        if not port:
            return {"status": "failed", "error": "No healthy ComfyUI instance", "output_files": []}

        workflow_json = task.get("workflow_json")
        if not workflow_json:
            params = task.get("params", {})
            workflow_json = params.get("workflow_json")
        if not workflow_json:
            return {"status": "failed", "error": "No workflow_json in task", "output_files": []}

        filename_map = {}
        transfer_errors = []
        for file_info in task.get("files", []):
            url = file_info.get("url", "")
            expected = file_info.get("filename", "")
            if not url:
                continue
            try:
                local_path = self._download_file(url, expected_filename=expected)
                comfyui_name = self._upload_to_comfyui(port, local_path)
                if not comfyui_name:
                    transfer_errors.append(f"{expected or url}: upload to ComfyUI failed")
                    continue
                if expected and comfyui_name != expected:
                    filename_map[expected] = comfyui_name
            except Exception as e:
                logger.error(f"File transfer failed for {expected}: {e}")
                transfer_errors.append(f"{expected or url}: {e}")

        if transfer_errors:
            return {
                "status": "failed",
                "error": "File transfer failed: " + "; ".join(transfer_errors),
                "output_files": [],
            }

        workflow_str = json.dumps(workflow_json)
        for old_name, new_name in filename_map.items():
            if old_name and new_name:
                workflow_str = workflow_str.replace(old_name, new_name)
                logger.info(f"Replaced filename in workflow: {old_name} -> {new_name}")
        final_workflow = json.loads(workflow_str)

        resp = requests.post(
            f"http://127.0.0.1:{port}/prompt",
            json={"prompt": final_workflow},
            timeout=30
        )
        if not resp.ok:
            return {
                "status": "failed",
                "error": f"ComfyUI /prompt failed: HTTP {resp.status_code} {resp.text[:1000]}",
                "output_files": [],
            }
        prompt_id = resp.json().get("prompt_id")
        if not prompt_id:
            return {"status": "failed", "error": "No prompt_id returned", "output_files": []}

        try:
            output_files = self._wait_for_completion(port, prompt_id)
        except Exception as e:
            return {
                "status": "failed",
                "error": f"ComfyUI prompt {prompt_id} failed: {e}",
                "output_files": [],
            }
        if not output_files:
            return {
                "status": "failed",
                "error": f"ComfyUI prompt {prompt_id} finished without downloadable output files",
                "output_files": [],
            }
        return {"status": "completed", "output_files": output_files}

    def execute_api_call_task(self, task):
        data = task.get("params", {}) or task.get("data", {})
        endpoint = data.get("endpoint", "")
        method = data.get("method", "POST").upper()
        headers = data.get("headers", {})
        body = data.get("body", {})
        proxy = data.get("proxy", "")
        api_key = data.get("api_key", "")

        if api_key:
            headers.setdefault("Authorization", f"Bearer {api_key}")
        headers.setdefault("Content-Type", "application/json")

        proxies = {"http": proxy, "https": proxy} if proxy else None

        try:
            if method == "POST":
                resp = requests.post(endpoint, json=body, headers=headers, proxies=proxies, timeout=120)
            else:
                resp = requests.get(endpoint, headers=headers, proxies=proxies, timeout=120)
            if not resp.ok:
                return {
                    "status": "failed",
                    "error": f"API call failed: HTTP {resp.status_code} {resp.text[:1000]}",
                    "output_files": [],
                }
            api_response = resp.json()
            result_payload = {
                "http_status": resp.status_code,
                "response_type": type(api_response).__name__,
                "response_size": len(resp.text),
            }
            if isinstance(api_response, dict):
                result_payload["object_count"] = len(api_response)
                result_payload["keys_sample"] = list(api_response.keys())[:50]
                if endpoint.rstrip("/").endswith("/object_info"):
                    interesting = [
                        "TextEncodeQwenImageEdit",
                        "TextEncodeQwenImageEditPlus",
                        "FluxKontextMultiReferenceLatentMethod",
                        "LayerUtility: ImageScaleByAspectRatio V2",
                        "ImageScaleToTotalPixels",
                        "EmptyLatentImage",
                        "EmptySD3LatentImage",
                        "VAEEncode",
                        "KSampler",
                        "CFGNorm",
                        "ModelSamplingAuraFlow",
                        "UNETLoader",
                        "CLIPLoader",
                        "VAELoader",
                        "LoraLoaderModelOnly",
                    ]
                    result_payload["interesting_nodes"] = {
                        key: key in api_response for key in interesting
                    }
            return {"status": "completed", "result_payload": result_payload, "output_files": []}
        except Exception as e:
            return {"status": "failed", "error": str(e), "output_files": []}

    def complete(self, task_id, status, duration, output_files=None, error="", result_payload=None):
        files_payload = []
        for fpath in (output_files or []):
            if os.path.exists(fpath):
                files_payload.append(("files", (os.path.basename(fpath), open(fpath, "rb"))))

        form_data = {
            "task_id": task_id,
            "agent_id": self.agent_id,
            "status": status,
            "duration": str(round(duration, 2)),
            "error_message": error,
        }
        if result_payload:
            form_data["result_json"] = json.dumps(result_payload, ensure_ascii=False)
        try:
            requests.post(
                f"{self.server_url}/api/agent/complete",
                data=form_data,
                files=files_payload if files_payload else None,
                headers=self._headers(),
                timeout=120
            )
        except Exception as e:
            logger.error(f"Failed to report completion: {e}")
        finally:
            for _, (_, fobj) in files_payload:
                fobj.close()

    def _pick_healthy_port(self):
        for p in self.ports:
            if self._check_comfyui(p) == "healthy":
                return p
        return None

    def _download_file(self, url, expected_filename=None):
        local_dir = Path("/tmp/agent_downloads")
        local_dir.mkdir(parents=True, exist_ok=True)
        if expected_filename:
            filename = expected_filename
        else:
            filename = url.split("/")[-1].split("?")[0] or "download"
        local_path = local_dir / filename
        headers = self._headers() if self.server_url and not url.startswith("http://127.0.0.1") else {}
        full_url = url if url.startswith("http") else f"{self.server_url}{url}"
        resp = requests.get(full_url, headers=headers, timeout=120, stream=True)
        resp.raise_for_status()
        local_path.write_bytes(resp.content)
        logger.info(f"Downloaded {full_url} -> {local_path} ({len(resp.content)} bytes)")
        return str(local_path)

    def _upload_to_comfyui(self, port, local_path):
        try:
            with open(local_path, "rb") as f:
                resp = requests.post(
                    f"http://127.0.0.1:{port}/upload/image",
                    files={"image": (os.path.basename(local_path), f)},
                    data={"overwrite": "true"},
                    timeout=30
                )
            resp.raise_for_status()
            name = resp.json().get("name", "")
            logger.info(f"Uploaded to ComfyUI:{port} as {name}")
            return name
        except Exception as e:
            logger.error(f"Upload to ComfyUI failed: {e}")
            return None

    def _wait_for_completion(self, port, prompt_id, timeout=600):
        start = time.time()
        while time.time() - start < timeout:
            try:
                resp = requests.get(f"http://127.0.0.1:{port}/history/{prompt_id}", timeout=10)
                history = resp.json()
                if prompt_id in history:
                    entry = history[prompt_id]
                    status_info = entry.get("status") or {}
                    status_str = str(status_info.get("status_str") or "").lower()
                    if status_str in {"error", "failed"}:
                        messages = entry.get("status", {}).get("messages", [])
                        raise RuntimeError(
                            "ComfyUI execution failed: "
                            + json.dumps({"status": status_info, "messages": messages}, ensure_ascii=False)[:1500]
                        )

                    outputs = entry.get("outputs", {})
                    is_done = (
                        status_info.get("completed") is True
                        or status_str in {"success", "completed"}
                    )
                    if is_done:
                        if not outputs:
                            raise RuntimeError(
                                "ComfyUI completed without outputs: "
                                + json.dumps({"status": status_info}, ensure_ascii=False)[:1000]
                            )
                        files = []
                        for node_output in outputs.values():
                            for img in node_output.get("images", []):
                                files.append(self._download_comfyui_output(port, img))
                            for vid in node_output.get("gifs", []) + node_output.get("videos", []):
                                files.append(self._download_comfyui_output(port, vid))
                        downloaded = [f for f in files if f]
                        if not downloaded:
                            raise RuntimeError(
                                "ComfyUI produced outputs but no files could be downloaded: "
                                + json.dumps(outputs, ensure_ascii=False)[:1500]
                            )
                        return downloaded
            except RuntimeError:
                raise
            except Exception as e:
                logger.debug(f"History poll failed for {prompt_id}: {e}")
            time.sleep(2)
        logger.warning(f"Task timed out after {timeout}s")
        return []

    def _download_comfyui_output(self, port, file_info):
        fname = file_info.get("filename", "")
        subfolder = file_info.get("subfolder", "")
        ftype = file_info.get("type", "output")
        url = f"http://127.0.0.1:{port}/view?filename={fname}&subfolder={subfolder}&type={ftype}"
        try:
            local_path = self._download_file(url, expected_filename=fname)
            if local_path and fname.lower().endswith(('.png', '.jpg', '.jpeg')):
                return self._convert_to_webp_lossless(local_path)
            return local_path
        except Exception as e:
            logger.error(f"Failed to download output {fname}: {e}")
            return None

    @staticmethod
    def _convert_to_webp_lossless(path):
        """将 PNG/JPG 转换为 WebP 无损格式"""
        try:
            from PIL import Image
            original_size = os.path.getsize(path)
            img = Image.open(path)
            webp_path = str(Path(path).with_suffix('.webp'))
            img.save(webp_path, format='WEBP', lossless=True)
            new_size = os.path.getsize(webp_path)
            os.remove(path)
            logger.info(f"WebP lossless: {original_size} -> {new_size} bytes (saved {original_size - new_size})")
            return webp_path
        except Exception as e:
            logger.debug(f"WebP conversion skipped: {e}")
            return path

    def run(self):
        retry_delay = 5
        while self.running:
            try:
                self.register()
                break
            except Exception as e:
                logger.error(f"Registration failed: {e}. Retrying in {retry_delay}s...")
                time.sleep(retry_delay)
                retry_delay = min(retry_delay * 2, 60)

        logger.info(f"Agent running. Polling every {POLL_INTERVAL}s...")
        last_heartbeat = 0
        empty_polls = 0

        while self.running:
            try:
                now = time.time()
                if now - last_heartbeat >= HEARTBEAT_INTERVAL:
                    self.heartbeat()
                    last_heartbeat = now

                task = self.poll()
                if task:
                    empty_polls = 0
                    task_id = task["task_id"]
                    task_type = task.get("task_type", "comfyui")
                    logger.info(f"Received task: {task_id} (type={task_type})")
                    self.current_tasks += 1
                    start_time = time.time()
                    try:
                        if task_type == "api_call":
                            result = self.execute_api_call_task(task)
                        else:
                            result = self.execute_comfyui_task(task)
                        duration = time.time() - start_time
                        self.complete(
                            task_id, result.get("status", "completed"), duration,
                            output_files=result.get("output_files", []),
                            error=result.get("error", ""),
                            result_payload=result.get("result_payload")
                        )
                        logger.info(f"Task {task_id} {result['status']} in {duration:.1f}s")
                    except Exception as e:
                        duration = time.time() - start_time
                        logger.error(f"Task {task_id} failed: {e}")
                        self.complete(task_id, "failed", duration, error=str(e))
                    finally:
                        self.current_tasks -= 1
                else:
                    empty_polls += 1
                    if empty_polls % 30 == 0:
                        logger.info(f"[STATUS] {empty_polls} consecutive empty polls (~{empty_polls * POLL_INTERVAL}s)")
                    time.sleep(POLL_INTERVAL)
            except requests.ConnectionError:
                logger.warning("Connection lost. Retrying in 10s...")
                time.sleep(10)
            except Exception as e:
                logger.error(f"Unexpected error: {e}")
                time.sleep(POLL_INTERVAL)


def main():
    parser = argparse.ArgumentParser(description="ComfyUI GPU Agent")
    parser.add_argument("--server", required=True, help="Backend URL")
    parser.add_argument("--token", required=True, help="Agent registration token")
    parser.add_argument("--ports", required=True, help="ComfyUI ports, comma-separated")
    args = parser.parse_args()
    ports = [int(p.strip()) for p in args.ports.split(",")]
    logger.info(f"Starting agent -> {args.server}")
    logger.info(f"ComfyUI ports: {ports}")
    logger.info(f"Agent version: {AGENT_VERSION}")
    agent = ComfyUIAgent(args.server, args.token, ports)
    agent.run()


if __name__ == "__main__":
    main()

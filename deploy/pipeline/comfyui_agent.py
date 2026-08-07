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
import re
import signal
import subprocess
import sys
import threading
import time
import requests
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger("comfyui-agent")

POLL_INTERVAL = 3
HEARTBEAT_INTERVAL = 3
AGENT_VERSION = "2026-08-07-background-heartbeat-v1"
PLATFORM_DOWNLOAD_RETRIES = 3
PLATFORM_DOWNLOAD_PATH_PREFIXES = ("/api/agent/tasks/", "/storage/")
CAPABILITY_CACHE_TTL_SECONDS = 60
MINIMAX_H3_REQUIRED_NODES = (
    "MiniMaxH3ImageToVideo",
    "UNETLoader",
    "CLIPLoader",
    "VAELoader",
    "VAEDecode",
    "VAEDecodeAudio",
    "BasicScheduler",
    "KSamplerSelect",
    "SamplerCustomAdvanced",
    "BasicGuider",
    "RandomNoise",
    "CreateVideo",
    "SaveVideo",
)


class ComfyUIAgent:
    def __init__(self, server_url: str, token: str, ports: list):
        self.server_url = server_url.rstrip("/")
        self.token = token
        self.ports = ports
        self.agent_id = None
        self.running = True
        self.current_tasks = 0
        self._capability_cache = {}
        self._heartbeat_stop = threading.Event()
        self._heartbeat_thread = None
        state_root = Path(
            os.environ.get("MECHA_AGENT_STATE_DIR")
            or (Path.home() / ".mecha-agent")
        )
        self.pending_completion_dir = state_root / "pending-completions"
        self.pending_completion_dir.mkdir(parents=True, exist_ok=True)
        self.completion_retry_delays = (0, 5, 15, 30)
        self.completion_upload_timeout = (
            30,
            int(os.environ.get("MECHA_COMPLETION_UPLOAD_TIMEOUT", "600")),
        )
        signal.signal(signal.SIGTERM, self._shutdown)
        signal.signal(signal.SIGINT, self._shutdown)

    def _shutdown(self, *args):
        logger.info("Shutting down gracefully...")
        self.running = False
        self._heartbeat_stop.set()

    def _headers(self):
        return {"Authorization": f"Bearer {self.token}"}

    def _is_platform_download_url(self, url):
        """Only permit a TLS fallback for authenticated files on this backend."""
        target = urlsplit(str(url or ""))
        server = urlsplit(self.server_url)
        target_port = target.port or (443 if target.scheme == "https" else 80)
        server_port = server.port or (443 if server.scheme == "https" else 80)
        return (
            target.scheme == "https"
            and target.hostname == server.hostname
            and target_port == server_port
            and any(target.path.startswith(prefix) for prefix in PLATFORM_DOWNLOAD_PATH_PREFIXES)
        )

    def _get_platform_download(self, url, *, headers, timeout, stream=False):
        """Retry transient downloads; narrowly recover a broken same-origin certificate."""
        last_error = None
        for attempt in range(1, PLATFORM_DOWNLOAD_RETRIES + 1):
            try:
                return requests.get(
                    url,
                    headers=headers,
                    timeout=timeout,
                    stream=stream,
                )
            except (requests.exceptions.SSLError, requests.exceptions.ConnectionError) as exc:
                last_error = exc
                logger.warning(
                    "Platform download attempt %s/%s failed for %s: %s",
                    attempt,
                    PLATFORM_DOWNLOAD_RETRIES,
                    urlsplit(url).path,
                    exc,
                )

        if isinstance(last_error, requests.exceptions.SSLError) and self._is_platform_download_url(url):
            logger.error(
                "Platform TLS verification failed repeatedly for %s; "
                "retrying this same-origin file once without certificate verification",
                urlsplit(url).path,
            )
            return requests.get(
                url,
                headers=headers,
                timeout=timeout,
                stream=stream,
                verify=False,
            )
        if last_error:
            raise last_error
        raise RuntimeError(f"Platform download failed without an error: {url}")

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
        endpoints = ["/system_stats", "/"]
        had_connection_issue = False
        for path in endpoints:
            try:
                resp = requests.get(f"http://127.0.0.1:{port}{path}", timeout=5)
                if resp.status_code == 200:
                    return "healthy"
            except Exception:
                had_connection_issue = True
                continue
        return "offline" if had_connection_issue else "unhealthy"

    def _probe_comfyui_capabilities(self, port: int, status: str = "") -> dict:
        """Return a small, cacheable capability summary for one local ComfyUI port."""
        if status and status != "healthy":
            return {}
        now = time.time()
        cached = self._capability_cache.get(port)
        if cached and now - cached.get("checked_at", 0) < CAPABILITY_CACHE_TTL_SECONDS:
            return dict(cached.get("capabilities") or {})
        capabilities = {}
        try:
            resp = requests.get(f"http://127.0.0.1:{port}/object_info", timeout=10)
            if resp.status_code == 200:
                object_info = resp.json()
                required = {
                    node: node in object_info
                    for node in MINIMAX_H3_REQUIRED_NODES
                }
                capabilities = {
                    "minimax_h3_fl2va": all(required.values()),
                    "minimax_h3_required_nodes": required,
                }
        except Exception as exc:
            logger.debug("Capability probe failed for ComfyUI:%s: %s", port, exc)
        self._capability_cache[port] = {
            "checked_at": now,
            "capabilities": capabilities,
        }
        return dict(capabilities)

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
        instances = []
        for p in self.ports:
            status = self._check_comfyui(p)
            instance = {"port": p, "status": status}
            capabilities = self._probe_comfyui_capabilities(p, status)
            if capabilities:
                instance["capabilities"] = capabilities
            instances.append(instance)
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

    def _heartbeat_loop(self):
        """Keep node presence fresh while the main thread runs a long GPU task."""
        while self.running and not self._heartbeat_stop.is_set():
            try:
                self.heartbeat()
            except Exception as exc:
                logger.warning("Heartbeat loop failed: %s", exc)
            self._heartbeat_stop.wait(HEARTBEAT_INTERVAL)

    def _start_heartbeat_thread(self):
        if self._heartbeat_thread and self._heartbeat_thread.is_alive():
            return
        self._heartbeat_stop.clear()
        self._heartbeat_thread = threading.Thread(
            target=self._heartbeat_loop,
            name="mecha-agent-heartbeat",
            daemon=True,
        )
        self._heartbeat_thread.start()

    def _stop_heartbeat_thread(self):
        self._heartbeat_stop.set()
        thread = self._heartbeat_thread
        if thread and thread.is_alive() and thread is not threading.current_thread():
            thread.join(timeout=2)

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

    @staticmethod
    def _task_params(task):
        for key in ("params", "data"):
            value = task.get(key)
            if isinstance(value, dict):
                return value
        return {}

    @staticmethod
    def _truthy(value):
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return value != 0
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return False

    def execute_comfyui_task(self, task):
        params = self._task_params(task)
        preferred_port = params.get("preferred_comfyui_port") or task.get("preferred_comfyui_port")
        try:
            preferred_port = int(preferred_port) if preferred_port else None
        except (TypeError, ValueError):
            preferred_port = None
        strict_preferred_port = self._truthy(
            params.get("strict_preferred_comfyui_port")
            or task.get("strict_preferred_comfyui_port")
        )
        port = self._pick_healthy_port(
            preferred_port=preferred_port,
            strict_preferred=strict_preferred_port,
        )
        if not port:
            if preferred_port:
                return {
                    "status": "failed",
                    "error": f"No healthy ComfyUI instance on preferred port {preferred_port}",
                    "output_files": [],
                }
            return {"status": "failed", "error": "No healthy ComfyUI instance", "output_files": []}

        task_type = task.get("task_type", "comfyui")
        workflow_name = task.get("workflow_name")
        if not workflow_name:
            workflow_name = params.get("workflow_name")
        workflow_name = workflow_name or task_type

        workflow_json = task.get("workflow_json")
        if not workflow_json:
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
                "error": (
                    f"task_type={task_type} workflow={workflow_name} "
                    f"ComfyUI /prompt failed: HTTP {resp.status_code} {resp.text[:1000]}"
                ),
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

    def execute_agent_control_task(self, task):
        data = task.get("params", {}) or task.get("data", {})
        action = data.get("action", "status")

        if action == "status":
            return {
                "status": "completed",
                "result_payload": {
                    "action": action,
                    "agent_id": self.agent_id,
                    "agent_version": AGENT_VERSION,
                    "hostname": platform.node(),
                    "pid": os.getpid(),
                    "cwd": os.getcwd(),
                    "script_path": str(Path(__file__).resolve()),
                    "python": sys.executable,
                    "ports": self.ports,
                },
                "output_files": [],
            }

        if action == "self_update":
            result = self._self_update(data)
            return {
                "status": "completed",
                "result_payload": result,
                "output_files": [],
                "restart_agent": True,
            }

        if action == "install_h3_sidecar":
            result = self._install_h3_sidecar(data)
            return {
                "status": "completed",
                "result_payload": result,
                "output_files": [],
                "restart_agent": True,
            }

        return {
            "status": "failed",
            "error": f"Unsupported agent_control action: {action}",
            "output_files": [],
        }

    def _self_update(self, data):
        script_url = data.get("script_url") or f"{self.server_url}/storage/tools/comfyui_agent.py"
        current_path = Path(__file__).resolve()
        tmp_path = current_path.with_name(f".{current_path.name}.download")
        backup_path = current_path.with_name(
            f"{current_path.name}.bak.{time.strftime('%Y%m%d%H%M%S')}"
        )

        resp = self._get_platform_download(
            script_url,
            headers=self._headers(),
            timeout=60,
        )
        resp.raise_for_status()
        content = resp.text
        if "class ComfyUIAgent" not in content or "AGENT_VERSION" not in content:
            raise RuntimeError("Downloaded script does not look like comfyui_agent.py")

        version_match = re.search(r'AGENT_VERSION\s*=\s*["\']([^"\']+)["\']', content)
        new_version = version_match.group(1) if version_match else "unknown"
        tmp_path.write_text(content, encoding="utf-8")
        os.chmod(tmp_path, 0o755)
        current_path.replace(backup_path)
        tmp_path.replace(current_path)

        return {
            "action": "self_update",
            "agent_id": self.agent_id,
            "old_version": AGENT_VERSION,
            "new_version": new_version,
            "script_url": script_url,
            "script_path": str(current_path),
            "backup_path": str(backup_path),
            "restart": True,
        }

    def _download_text_tool(self, filename, markers=None):
        safe_name = str(filename or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", safe_name):
            raise RuntimeError(f"Unsafe tool filename: {filename!r}")
        url = f"{self.server_url}/storage/tools/{safe_name}"
        resp = self._get_platform_download(
            url,
            headers=self._headers(),
            timeout=120,
        )
        resp.raise_for_status()
        text = resp.text
        for marker in markers or ():
            if marker not in text:
                raise RuntimeError(f"Downloaded {safe_name} is missing marker: {marker}")
        return url, text

    @staticmethod
    def _write_text_with_backup(path, content):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            old = path.read_text(encoding="utf-8", errors="replace")
            if old == content:
                return {"path": str(path), "changed": False, "backup": ""}
            backup = path.with_name(f"{path.name}.bak.{time.strftime('%Y%m%d%H%M%S')}")
            path.replace(backup)
        else:
            backup = None
        path.write_text(content, encoding="utf-8")
        return {"path": str(path), "changed": True, "backup": str(backup or "")}

    def _install_h3_sidecar(self, data):
        if platform.system().lower() != "windows":
            raise RuntimeError("MiniMax H3 sidecar installer is only supported on Windows GPU agents")

        root = Path(os.environ.get("MECHA_GPU_ROOT", r"E:\MECHA-GPU"))
        agent_dir = root / "agent"
        scripts_dir = root / "scripts"
        installed = []

        tool_specs = [
            (
                "windows_gpu_agent_runner.py",
                agent_dir / "windows_gpu_agent_runner.py",
                ("GPU2_H3_PORT = 8189", "build_gpu2_minimax_h3_fl2va_workflow"),
            ),
            (
                "windows_gpu_h3_setup.ps1",
                scripts_dir / "windows_gpu_h3_setup.ps1",
                ("MiniMax H3", "MECHA-GPU-ComfyUI-H3"),
            ),
            (
                "windows_gpu_h3_setup.cmd",
                scripts_dir / "windows_gpu_h3_setup.cmd",
                ("windows_gpu_h3_setup.ps1",),
            ),
            (
                "windows_gpu_h3_smoke.py",
                scripts_dir / "windows_gpu_h3_smoke.py",
                ("MiniMax H3", "build_gpu2_minimax_h3_fl2va_workflow"),
            ),
            (
                "windows_gpu_h3_smoke.cmd",
                scripts_dir / "windows_gpu_h3_smoke.cmd",
                ("windows_gpu_h3_smoke.py",),
            ),
            (
                "windows_gpu_start_h3_comfyui.cmd",
                scripts_dir / "windows_gpu_start_h3_comfyui.cmd",
                ("ComfyUI-H3", "8189"),
            ),
            (
                "windows_gpu_start_agent.cmd",
                scripts_dir / "windows_gpu_start_agent.cmd",
                ("windows_gpu_agent_runner.py", "MECHA_COMFYUI_PORTS=8188,8189"),
            ),
        ]

        downloads = []
        for filename, destination, markers in tool_specs:
            url, text = self._download_text_tool(filename, markers)
            downloads.append({"filename": filename, "url": url, "destination": str(destination)})
            installed.append(self._write_text_with_backup(destination, text))

        setup_path = scripts_dir / "windows_gpu_h3_setup.ps1"
        command = [
            "powershell.exe",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(setup_path),
            "-NoAgentRestart",
        ]
        if data.get("skip_model_downloads"):
            command.append("-SkipModelDownloads")
        if data.get("force_refresh_comfyui"):
            command.append("-ForceRefreshComfyUI")

        timeout_seconds = int(data.get("timeout_seconds") or 4 * 60 * 60)
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
        )
        stdout = completed.stdout or ""
        stderr = completed.stderr or ""
        if completed.returncode != 0:
            tail = (stdout + "\n" + stderr)[-4000:]
            raise RuntimeError(f"MiniMax H3 setup failed with exit code {completed.returncode}: {tail}")

        os.environ["MECHA_COMFYUI_PORTS"] = "8188,8189"

        return {
            "action": "install_h3_sidecar",
            "agent_id": self.agent_id,
            "root": str(root),
            "installed": installed,
            "downloads": downloads,
            "setup_returncode": completed.returncode,
            "setup_stdout_tail": stdout[-3000:],
            "setup_stderr_tail": stderr[-3000:],
            "ports_after_restart": [8188, 8189],
            "restart": True,
        }

    def _restart_process(self):
        logger.info("Restarting agent process with original argv...")
        time.sleep(1)
        os.execv(sys.executable, [sys.executable] + sys.argv)

    def _pending_completion_path(self, task_id):
        safe_task_id = re.sub(r"[^A-Za-z0-9_.-]", "_", str(task_id))
        return self.pending_completion_dir / f"{safe_task_id}.json"

    def _save_pending_completion(self, record):
        path = self._pending_completion_path(record["task_id"])
        tmp_path = path.with_suffix(".json.tmp")
        tmp_path.write_text(
            json.dumps(record, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        tmp_path.replace(path)
        return path

    def _report_completion_once(self, record):
        files_payload = []
        for fpath in record.get("output_files") or []:
            if os.path.exists(fpath):
                files_payload.append(("files", (os.path.basename(fpath), open(fpath, "rb"))))

        form_data = {
            "task_id": record["task_id"],
            "agent_id": self.agent_id,
            "status": record["status"],
            "duration": str(round(float(record.get("duration") or 0), 2)),
            "error_message": record.get("error") or "",
        }
        if record.get("result_payload"):
            form_data["result_json"] = json.dumps(
                record["result_payload"],
                ensure_ascii=False,
            )
        try:
            response = requests.post(
                f"{self.server_url}/api/agent/complete",
                data=form_data,
                files=files_payload if files_payload else None,
                headers=self._headers(),
                timeout=self.completion_upload_timeout,
            )
            response.raise_for_status()
            return True
        finally:
            for _, (_, fobj) in files_payload:
                fobj.close()

    def _report_pending_completion(self, record):
        task_id = record["task_id"]
        for attempt, delay in enumerate(self.completion_retry_delays, start=1):
            if delay:
                time.sleep(delay)
            try:
                if self._report_completion_once(record):
                    self._pending_completion_path(task_id).unlink(missing_ok=True)
                    logger.info(
                        "Reported completion for %s on attempt %s",
                        task_id,
                        attempt,
                    )
                    return True
            except Exception as exc:
                logger.error(
                    "Failed to report completion for %s (attempt %s/%s): %s",
                    task_id,
                    attempt,
                    len(self.completion_retry_delays),
                    exc,
                )
        return False

    def _flush_pending_completions(self):
        pending_paths = sorted(self.pending_completion_dir.glob("*.json"))
        for path in pending_paths:
            try:
                record = json.loads(path.read_text(encoding="utf-8"))
            except Exception as exc:
                logger.error("Invalid pending completion record %s: %s", path, exc)
                path.rename(path.with_suffix(".invalid"))
                continue
            if not self._report_pending_completion(record):
                return False
        return True

    def complete(self, task_id, status, duration, output_files=None, error="", result_payload=None):
        record = {
            "task_id": str(task_id),
            "status": str(status),
            "duration": float(duration or 0),
            "output_files": [
                str(path)
                for path in (output_files or [])
                if path and os.path.exists(path)
            ],
            "error": str(error or ""),
            "result_payload": result_payload,
            "created_at": datetime.now().isoformat(),
        }
        self._save_pending_completion(record)
        return self._report_pending_completion(record)

    def _pick_healthy_port(self, preferred_port=None, strict_preferred=False):
        if preferred_port:
            if preferred_port in self.ports and self._check_comfyui(preferred_port) == "healthy":
                return preferred_port
            if strict_preferred:
                return None
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
        resp = self._get_platform_download(
            full_url,
            headers=headers,
            timeout=120,
            stream=True,
        )
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
        empty_polls = 0
        self._start_heartbeat_thread()

        while self.running:
            try:
                if not self._flush_pending_completions():
                    logger.warning(
                        "Pending completion report is still unavailable; "
                        "new tasks will not be claimed until it is delivered."
                    )
                    time.sleep(10)
                    continue

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
                        elif task_type == "agent_control":
                            result = self.execute_agent_control_task(task)
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
                        if result.get("restart_agent"):
                            self._restart_process()
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

        self._stop_heartbeat_thread()


def main():
    parser = argparse.ArgumentParser(description="Processing Cluster Node")
    parser.add_argument("--server", required=True, help="Backend URL")
    parser.add_argument("--token", required=True, help="Agent registration token")
    parser.add_argument("--ports", required=True, help="Processing service ports, comma-separated")
    args = parser.parse_args()
    ports = [int(p.strip()) for p in args.ports.split(",")]
    logger.info(f"Starting agent -> {args.server}")
    logger.info(f"ComfyUI ports: {ports}")
    logger.info(f"Agent version: {AGENT_VERSION}")
    agent = ComfyUIAgent(args.server, args.token, ports)
    agent.run()


if __name__ == "__main__":
    main()

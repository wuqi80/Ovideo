"""网络/文件安全护栏：SSRF 防护 + 本地路径收敛。

集中实现，供所有"下载用户提供的 URL"和"把 /storage 映射到磁盘"的地方复用，
避免各处各写一套（审计发现 SSRF/路径遍历散落多处）。

- assert_public_http_url(url): 仅允许 http/https 且目标 IP 非内网/回环/链路本地/保留，
  拒绝 GCP 元数据 169.254.169.254 与 metadata.google.internal。防止 SSRF 打内网/偷令牌。
- safe_storage_path(url, project_root): 把 /storage/... 或相对路径解析为磁盘绝对路径，
  并强制收敛在 persistent_storage/ 内，越界即抛错。防止 ../ 路径遍历读任意文件。
"""
import os
import socket
import ipaddress
from urllib.parse import urlparse

# 禁止解析/访问的主机名（云元数据等）
_BLOCKED_HOSTS = {
    "metadata.google.internal",
    "metadata",
    "metadata.goog",
}


def assert_public_http_url(url: str) -> None:
    """校验 url 为指向公网的 http/https 地址；否则抛 ValueError。

    防 SSRF：拒绝私网(10/172.16/192.168)、回环(127/::1)、链路本地(169.254 含 GCP 元数据)、
    保留/多播/未指定地址，以及已知元数据主机名。解析全部 A/AAAA 记录，任一命中即拒绝
    （对 DNS rebinding 的基础防护）。
    """
    if not isinstance(url, str) or not url:
        raise ValueError("空 URL")
    p = urlparse(url)
    if p.scheme not in ("http", "https"):
        raise ValueError(f"不允许的 URL scheme: {p.scheme!r}（仅 http/https）")
    host = p.hostname
    if not host:
        raise ValueError("URL 缺少主机名")
    if host.lower() in _BLOCKED_HOSTS:
        raise ValueError(f"禁止访问元数据/内部主机: {host}")
    # 若 host 本身就是 IP 字面量，直接判定
    try:
        literal_ip = ipaddress.ip_address(host)
        _assert_ip_public(literal_ip)
        return
    except ValueError:
        pass  # 不是 IP 字面量，走 DNS 解析
    port = p.port or (443 if p.scheme == "https" else 80)
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as e:
        raise ValueError(f"无法解析主机 {host}: {e}")
    for info in infos:
        _assert_ip_public(ipaddress.ip_address(info[4][0]))


def _assert_ip_public(ip) -> None:
    if (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
            or ip.is_multicast or ip.is_unspecified):
        raise ValueError(f"禁止访问内网/保留地址: {ip}")


def safe_storage_path(url: str, project_root: str) -> str:
    """把 /storage/... 或相对路径解析为磁盘绝对路径，强制收敛在 persistent_storage/ 内。

    防路径遍历：用 realpath 解析后校验仍位于 persistent_storage 之下，越界抛 ValueError。
    """
    base = os.path.realpath(os.path.join(project_root, "persistent_storage"))
    if url.startswith("/storage/"):
        rel = url[len("/storage/"):]
    else:
        rel = url.lstrip("/")
    full = os.path.realpath(os.path.join(base, rel))
    if full != base and not full.startswith(base + os.sep):
        raise ValueError(f"路径越界，拒绝访问 persistent_storage 之外: {url}")
    return full

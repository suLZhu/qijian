"""Fail the production build if the APK contains the isolated layout prototype."""
import sys
from zipfile import ZipFile

with ZipFile(sys.argv[1]) as apk:
    root = "assets/public/"
    if root + "index.html" not in apk.namelist():
        raise SystemExit("APK is missing the production Web entry")
    scripts = [name for name in apk.namelist() if name.startswith(root) and name.endswith(".js")]
    if not scripts:
        raise SystemExit("APK is missing the production Web bundle")
    for name in scripts:
        content = apk.read(name)
        if any(marker.encode() in content for marker in ("qj-preview-label", "UI 原型 · 虚拟内容", "页面布局测试版 · 仅演示")):
            raise SystemExit(f"Layout prototype detected in {name}")

    bundle = b"".join(apk.read(name) for name in scripts)
    for marker in (b"qj-drawer-layer", b"qj-compose-input", b"qj-section-head", b"qj-room-hero"):
        if marker not in bundle:
            raise SystemExit(f"Production APK is missing a November 21 layout component: {marker!r}")

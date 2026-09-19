import os
import pathlib
import sys


env_path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/opt/agentforge-week1/.env")
api_key = sys.stdin.read().strip()
if not api_key:
    raise SystemExit("provider key missing")

values = {
    "AGENTFORGE_MODEL_PROTOCOL": "responses",
    "AGENTFORGE_MODEL_ENDPOINT": "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/responses",
    "AGENTFORGE_MODEL": "qwen3.6-flash",
    "AGENTFORGE_MODEL_API_KEY": api_key,
    "AGENTFORGE_MODEL_SITE_URL": "https://dtstest.64.177.10.182.nip.io/agentforge",
    "AGENTFORGE_MODEL_SITE_NAME": "AgentForge",
    "AGENTFORGE_MODEL_TIMEOUT_MS": "8000",
}

old_lines = env_path.read_text().splitlines() if env_path.exists() else []
kept = [line for line in old_lines if not any(line.startswith(f"{name}=") for name in values)]
env_path.write_text("\n".join(kept + [f"{name}={value}" for name, value in values.items()]) + "\n")
os.chmod(env_path, 0o600)
print(f"configured provider env at {env_path} (key length {len(api_key)})")

# 驾校招生业务系统 —— 容器镜像。只有 Python 标准库，不需要 pip 安装任何东西。
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    JX_DATA_DIR=/data \
    JX_HOST=0.0.0.0 \
    JX_PORT=8000 \
    JX_TZ_OFFSET=8

# 用固定编号的普通账号运行，数据放在 /data
RUN useradd --system --uid 10001 --user-group --home-dir /data --no-create-home --shell /usr/sbin/nologin jiaxiao \
    && mkdir -p /data \
    && chown jiaxiao:jiaxiao /data \
    && chmod 0750 /data

WORKDIR /app
COPY run.py ./
COPY app ./app
COPY templates ./templates
COPY static ./static

USER jiaxiao
VOLUME ["/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python3", "-c", "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/healthz' % os.environ.get('JX_PORT', '8000'), timeout=3)"]

CMD ["python3", "run.py", "serve"]

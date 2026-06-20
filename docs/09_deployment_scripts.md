# 复现脚本 / 部署脚本说明

## 一、Docker 部署（推荐）
```bash
docker-compose up -d
```

## 二、后端启动脚本
```bash
cd backend
python main.py
```

或使用 uvicorn：
```bash
uvicorn app:app --host 0.0.0.0 --port 8000
```

## 三、前端启动脚本
```bash
cd frontend
pnpm install
pnpm dev
```

## 四、数据库初始化
```bash
# 示例
python scripts/init_db.py
```

## 五、环境变量加载
确保 `.env` 文件已配置：
- API KEY
- DB URL
- Agent 配置参数

## 六、一键复现流程
1. 拉取仓库
2. 配置 .env
3. 启动 docker-compose
4. 访问前端页面

## 七、说明
本项目支持模块化部署，可单独运行 Agent 服务或完整系统部署。
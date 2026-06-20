# 运行环境配置说明

## 一、基础环境
建议环境：
- Python >= 3.10
- Node.js >= 18
- npm / pnpm（推荐 pnpm）
- Git

## 二、后端环境
如项目使用 Python 后端：
```bash
cd backend
pip install -r requirements.txt
python app.py / main.py
```

## 三、前端环境
```bash
cd frontend
npm install
npm run dev
```

或
```bash
pnpm install
pnpm dev
```

## 四、可选依赖
- 向量数据库（如 FAISS / Milvus）
- Redis（缓存/会话）
- PostgreSQL / MySQL（结构化数据）

## 五、环境变量示例
```env
OPENAI_API_KEY=xxx
DEEPSEEK_API_KEY=xxx
DATABASE_URL=xxx
```

## 六、启动流程
1. 启动后端服务
2. 启动前端服务
3. 配置 Agent API 地址
4. 登录并加载课程数据
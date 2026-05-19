# Balance Float

Windows 右上角半透明云资源悬浮窗，支持 DeepSeek、Vultr、阿里云和腾讯云。

## 功能

- 右上角置顶半透明悬浮窗，可拖动，可实时调节透明度，可隐藏到系统托盘。
- 托盘图标单击显示/隐藏，右键支持显示、刷新、隐藏、退出。
- 设置中填写 DeepSeek / Vultr API Key、阿里云 AccessKey、腾讯云 Secret、刷新间隔、透明度、开机自启、启动隐藏。
- API Key 使用 Electron `safeStorage` 加密保存；不可用时会降级为本机明文配置。
- DeepSeek 读取 `/user/balance`，Vultr 读取 `/v2/account`。
- Vultr 主显示“剩余额度”或“预计应付”，详情里保留账面余额和本月待结算。
- 服务器视图支持 Vultr Instances、阿里云 ECS `DescribeInstances`、腾讯云 CVM `DescribeInstances`。
- Vultr 服务器卡片按控制台口径显示近 31 天流量已用/剩余，即入站和出站中较大的方向，并展示实例 vCPU、内存、磁盘配置。
- DeepSeek 在服务器视图中显示公开服务状态页结果。
- 支持缩略模式，小窗强制收缩为迷你摘要，可一键切回完整模式。
- 网络请求使用 Electron 网络栈，会跟随系统代理，例如 Clash Verge 的系统代理/TUN 出口。

## 使用

直接运行：

```powershell
.\release\"Balance Float 1.0.7.exe"
```

开发运行：

```powershell
npm.cmd start
```

重新打包：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'
npm.cmd run pack
```

输出文件在 `release/Balance Float 1.0.7.exe`。

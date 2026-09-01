# 条码工作台

面向专业用户的浏览器条码工具，支持快速粘贴编号、Excel 批量导入以及 PNG、SVG 下载。

[在线使用](https://play.wangyifang.com/barcode/)

## 功能

- 一行一个编号，自动生成 CODE128 条码并预览最新一条。
- 支持单条 PNG、SVG 下载和多条 PNG 连续下载。
- 支持 `.xls`、`.xlsx` 文件导入、工作表选择、表头识别、编号列映射和数据预览。
- 条码宽高、文字、颜色和下载行为保存在浏览器本地。
- 支持亮色、暗色和跟随系统主题。
- 支持 iOS、Android 和桌面浏览器安装为 PWA，并可离线使用。

## 使用

需要 Node.js 20.19 及以上的 20.x 版本，或 Node.js 22.12 及以上版本。

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
```

构建产物位于 `dist/`，资源路径固定为 `/barcode/`。

## 数据与部署

条码内容和 Excel 文件均在浏览器本地处理，不会上传服务器。浏览器设置保存在本地存储中，最近下载状态保存在当前会话中。

本仓库维护应用源码；`play.wangyifang.com` 的 Cloudflare Workers 仓库只保存同步后的静态构建产物和部署配置。

## 版权说明

本仓库当前未声明开源许可证。公开可见不代表获得复制、修改或再分发授权。React、HeroUI、JsBarcode、SheetJS 等第三方依赖分别遵循其自身许可证。

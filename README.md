# 利率债一级工作台

面向利率债一级业务的浏览器工作台，包含：

- 一二级表增量识别、利差散点图与周报发行小结
- 发行计划与到期明细导入、周报 Word 生成
- 地方债发行计划增量导入（兼容原始源表与转换后日表）
- 侧栏独立地方债日表转换，不影响首页发行计划入库
- 本地数据备份导出与恢复

## 数据说明

GitHub Pages 版本不要求登录，上传的 Excel 和解析结果仅保存在当前浏览器，不会上传到 GitHub。更换电脑或浏览器前，请先点击“导出数据备份”，再在新设备中导入 JSON 备份。

## 本地运行

```bash
npm install
npm run dev
```

生产构建：

```bash
NEXT_PUBLIC_BASE_PATH=/bond-issuance-workbench npm run build
```

推送到 `main` 后，GitHub Actions 会自动构建并发布 GitHub Pages。

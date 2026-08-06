# Zephyrus TTML Database

Zephyrus Player 的自有逐字歌词覆盖库。该仓库只维护自制或已获授权的 TTML，客户端在本库未命中时继续回退到 AMLL TTML DataBase。

## Directory layout

- `raw-lyrics/`: 原始 TTML，以主网易云音乐 ID 命名。
- `metadata/catalog.json`: 跨平台 ID、发布状态和质量问题清单。
- `scripts/`: XML、分词时间与元数据校验，以及静态发布目录构建。
- `dist/`: 构建生成的静态服务目录，不提交到 Git。

## Workflow

1. 使用 AMLL TTML Tool 制作并预览歌词。
2. 将文件加入 `raw-lyrics/`，并在 `metadata/catalog.json` 中登记平台 ID。
3. 新文件先标记为 `draft`，修复所有校验问题后改为 `published`。
4. 运行 `npm test` 和 `npm run build`。
5. 将 `dist/` 原子部署到静态服务器。

```bash
npm install
npm test
npm run build
```

构建结果保持 AMLL 的目录约定，例如：

```text
dist/ncm-lyrics/3339553801.ttml
dist/qq-lyrics/002eCDhC3uiusq.ttml
dist/manifest.json
```

## Initial import

首批导入 6 份 TTML。3 份通过校验并可发布，3 份因时间轴或元数据问题保留为草稿。源目录 `C:\Users\Administrator\Desktop\野肆歌词` 不会被本仓库修改。

## License

尚未声明公开许可证。创建远端仓库和公开部署前，需要由维护者明确仓库可见性以及歌词内容的授权范围。

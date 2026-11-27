# 统一图标规范

功能图标统一使用 src/icons.tsx 的公共组件。图案来源为固定版本 Lucide，构建时生成 public/ui-icons 下独立 PNG。新增图标先登记 scripts/ui-icon-map.json，再增加公共组件导出。禁止旧 sprite、独立聊天图标、内联 SVG 功能图标及页面专用渲染器。品牌、头像、主题装饰不属于功能图标。

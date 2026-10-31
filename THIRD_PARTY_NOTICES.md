# Third-party notices / 第三方声明

This project is proprietary (see [LICENSE](LICENSE)). It includes or depends on the
third-party material below, which is **not** covered by that licence and remains
under its own terms.

本项目为专有软件（见 [LICENSE](LICENSE)）。下列第三方素材不受该许可约束，按各自的条款使用。

## Assets shipped with the site / 随网站发布的素材

| Material | Where | Author | Licence |
|---|---|---|---|
| “Vinus” 3D model | `public/models/venus.glb` (homepage statue) | [Thunk3D](https://sketchfab.com/Lily.Qin1), [source](https://sketchfab.com/3d-models/vinus-f834a1829fa240328525ff0292f4015e) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| Archivo (variable) | `@fontsource-variable/archivo` | Omnibus-Type | SIL Open Font License 1.1 |
| Red Room Display SC | `public/fonts/display-sc/` (subset of Noto Sans SC; licence in `OFL.txt`) | Google / Adobe (Noto Sans SC) | SIL Open Font License 1.1 |
| Noto Sans SC (variable) | `@fontsource-variable/noto-sans-sc` | Google / Adobe | SIL Open Font License 1.1 |

The CC BY 4.0 credit for the statue is shown to visitors on the `/copyright` page.
The model may have been converted or compressed for the web; no endorsement by the author is implied.

雕像模型的 CC BY 4.0 署名在网站 `/copyright` 页面向访客展示；模型可能为网页做过转换或压缩，不代表原作者认可本站。

## Runtime libraries / 运行时依赖

| Package | Licence |
|---|---|
| astro, @astrojs/node | MIT |
| three | MIT |
| gsap | GreenSock Standard “no charge” licence — https://gsap.com/standard-license |
| lenis | MIT |
| better-sqlite3 | MIT |
| temml | MIT |
| highlight.js | BSD-3-Clause |
| @netlify/blobs | MIT |

Development-only tools (Playwright, axe-core, TypeScript, parse5 and others) are not
distributed with the site. The full licence text of every package is in its folder
under `node_modules/` after `npm ci`.

仅用于开发的工具（Playwright、axe-core、TypeScript、parse5 等）不随网站发布。每个依赖的完整许可证文本在 `npm ci` 之后位于 `node_modules/` 下对应的目录中。

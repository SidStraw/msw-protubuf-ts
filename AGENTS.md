## 語系

所有回應跟思考過程都用 zh-TW 正體中文顯示

## 驗證

- 每次進度告一段落後，就執行 typescript 編譯器檢查，確保無類型錯誤。
- typescript 使用嚴格模式，tsc 驗證除非必要盡可能排除使用 any 如果使用要額外說明原因
- 修復後需要重新執行，確認最終修復

## Git worktree 路徑規範

- 專案已經統一使用 pnpm 沒有依賴項重複佔用空間的問題
- Git worktree 一律建立在專案目錄外，不可放在目前 repo 內或其子目錄中。
- 預設路徑使用 `~/worktrees/<repo>/<branch>`。
- 若不同 owner 下可能有同名 repo，改用 `~/worktrees/<owner>/<repo>/<branch>`。  

範例：

- `~/worktrees/face-studio-web/feature-xxx`
- `~/worktrees/LCT/face-studio-web/feature-xxx`  

目的：

- 避免 worktree 被專案內的 lint、test、watcher、glob 誤掃描
- 保持 repo 目錄乾淨
- 讓 worktree 位置更直觀、容易管理

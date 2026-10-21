# 安麗日記網頁版（實驗）

這是獨立的網頁版實驗，不會修改目前正在使用的 Google Apps Script 安麗日記。

## 目前可測試

- 使用 Google 帳號授權
- 在使用者自己的 Google Drive 建立「安麗日記資料」試算表
- 讀取人員名單
- 新增一筆測試人員
- 手機加入主畫面

## Google Cloud 設定

1. 建立或選擇 Google Cloud 專案。
2. 啟用 Google Sheets API 與 Google Drive API。
3. 設定 OAuth 同意畫面；測試期間把實際測試帳號加入測試使用者。
4. 建立「網頁應用程式」OAuth Client ID。
5. 在「已授權的 JavaScript 來源」加入：
   `https://binnu1025.github.io`
6. 把 Client ID 填入 `app.js` 的 `CLIENT_ID`。

Client ID 是前端公開識別碼，不是 API 金鑰；不要加入 Client Secret。

## 資料與權限

本實驗只要求 `drive.file`，只能存取由這個網站建立或由使用者明確授權的檔案。Google access token 只放在當次頁面記憶體；GitHub Pages 不會儲存人員資料。

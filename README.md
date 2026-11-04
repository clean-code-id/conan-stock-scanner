<div align="center">

# 📦 Conan Stock Scanner

**Scan a barcode with a USB/Bluetooth scanner or your phone camera. Stock updates in Google Sheets.**

No servers. No database. No app store. Just a barcode scanner or phone camera, a spreadsheet, and a link.

[**Open the scanner →**](https://clean-code-id.github.io/conan-stock-scanner/)

</div>

---

## ✨ What it does

| | |
|---|---|
| 🔎 **Physical scanner** | Scanner mode opens by default. Scan into the barcode field with a USB/Bluetooth keyboard scanner, then Enter opens the quantity dialog. Manual entry + **Cari** works too. |
| 📷 **Camera scanning** | Choose **Kamera** to scan with your phone camera. Camera access is only requested when selected. |
| ⬇️⬆️ **Barang Masuk / Keluar** | One tap to switch between stock in and stock out. |
| 🔢 **Quantity after scan** | See the product and current stock first, then type how many. A preview shows the stock after saving. |
| 🛡️ **Safe by default** | Can't take out more than you have. Wrong scan? Tap **Batal**. Saved by mistake? Tap **Batalkan**. |
| 👤 **Know who did what** | Every staff member has a personal link. Every change in the log records their name. |
| 🇮🇩 **Bahasa Indonesia** | The whole interface is in Indonesian, made for shop staff. |
| 💸 **Free to run** | GitHub Pages + Google Apps Script + Google Sheets. No cost at small-shop scale. |

## 🧭 How it works

```
 📱 Phone (camera)                 ☁️ Google Apps Script               📊 Google Sheet
┌──────────────────┐   key + SKU   ┌─────────────────────┐            ┌──────────────┐
│  Scanner page    │ ────────────► │  API                │ ─────────► │ Products     │
│  (GitHub Pages)  │               │  • checks the key   │            │ Log          │
│                  │ ◄──────────── │  • updates stock    │            │ Users        │
└──────────────────┘   new stock   │  • writes the log   │            │ Config       │
                                   └─────────────────────┘            └──────────────┘
```

- **The page** is one static HTML file hosted on GitHub Pages. It has no secrets in it.
- **The API** is a Google Apps Script web app attached to the sheet. It is not in this repo.
- **The sheet** is the database, and stays private to its owner.

## Using a physical scanner

1. Open your personal setup link on the computer/browser you will use.
2. Choose **Barang Masuk** or **Barang Keluar**. **Scanner** mode is selected by default.
3. Scan into **Barcode barang**. Configure the scanner to send Enter after each barcode, or click **Cari**.
4. Enter the quantity and click **Simpan**. The barcode field is ready for the next scan after saving or cancelling.

The scanner must work as a keyboard (typing barcode text). To use a camera instead, choose **Kamera**. Returning to **Scanner** stops the camera.

For a local preview, serve this folder (for example, `python3 -m http.server 8000`) and open `http://localhost:8000/preview/index.html#key=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`. The preview uses mock products `SKU-001`, `SKU-002`, and `SKU-003`; it does not update the real sheet.

## 🗂️ The sheet

| Tab | What's in it |
|---|---|
| **Products** | `SKU` · `Name` · `Qty`. The barcode is the SKU. |
| **Log** | `Time` · `SKU` · `Name` · `Mode` · `Change` · `Qty after` · `User`. Every scan and undo. |
| **Users** | `Name` · `Key` · `Active` · `Setup link`. One row per staff member. |
| **Config** | The scanner page URL, used to build setup links. |

## 👥 Adding staff

1. In the sheet, add a name to the **Users** tab.
2. Click **Stock Scanner → Generate keys & links**.
3. Send that person their **Setup link** (WhatsApp is fine).
4. They open it once on their phone, and they're signed in.

To remove someone, uncheck **Active**. Only their phone stops working.

## 🔐 Security, honestly

This is built to be **simple and good enough** for a small shop, not a bank.

- Each staff key is a random 128-bit value, so it can't be guessed.
- Keys live only in the private sheet. The key is removed from the address bar after sign-in.
- The API rejects unknown or deactivated keys before touching any data.
- Anyone who *has* a valid link can scan. Treat setup links like passwords.

## 🛠️ Making changes

| Change | Then do this |
|---|---|
| `index.html` (the page) | Commit and push to `main`. GitHub Pages updates in about a minute. |
| `Code.gs` (the API, in Apps Script) | **Deploy → Manage deployments → Edit → New version → Deploy.** The URL stays the same. |

## 🧱 Built with

[html5-qrcode](https://github.com/mebjas/html5-qrcode) for camera scanning · Google Apps Script · Google Sheets · GitHub Pages

---

<div align="center">

Crafted with ☕ by **[Clean Code](https://github.com/clean-code-id)**, for **Conan**.

</div>

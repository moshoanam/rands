# Rands – secure iPhone expense tracker (no Mac needed)

A Home Screen web app. It works offline, all data is encrypted, and nothing leaves your phone.

## The portal (tabs at the bottom)
- **Overview:** this month's income, expenses, money put into goals, what's left over and your savings rate, each compared with last month. Also a 6-month income vs expenses chart, budget status, top spending and your goals at a glance.
- **Expenses:** what you spend each month, with category budgets.
- **Income:** money in by source (Salary, Side income, Business, Rental, Interest, Refunds, Gifts). "Copy last month's income" fills in a regular salary in one tap.
- **Goals:** savings goals with a target amount and optional target date.
  - Add or withdraw money, with a full history.
  - Shows how much you need per month to hit the date, and when you'll get there at your current pace.
  - Marks each goal On track, Behind or Reached.
- **Imports:** money in from statements is imported as income. Salary is ticked automatically; you choose whether to tick anything else.

## Security
- **Passcode lock:** a 6-digit passcode is required to open the app. Easy patterns like 111111 or 123456 are rejected.
- **Encryption:** data is encrypted at rest with AES-256-GCM. The key is derived from your passcode with PBKDF2-SHA256 (600k iterations) and is only held in memory while the app is unlocked.
- **Face ID:** optional. It uses a passkey with the WebAuthn PRF extension (iOS 18+), so Face ID unwraps the encryption key itself instead of just showing or hiding the screen.
- **Lockouts:** after 5 wrong passcode attempts, entry is locked for 30 s, then 1 min, 2 min and so on, up to 1 hour.
- **Auto-lock:** choose immediately, 1, 5 or 15 minutes. Your numbers are hidden in the iOS app switcher.
- **Encrypted backups:** backups are protected by a password you choose. CSV exports are plain text and the app warns you before exporting one.
- **Strict Content-Security-Policy:** no third-party scripts, no network calls, and all libraries are bundled with the app.
- **No recovery:** if you forget your passcode the data can't be recovered. Keep a backup.

## Import (Settings → Import, or the ⇪ Import link)
- **Bank statements:** .xlsx, .csv or text-based PDF (FNB, Standard Bank, Absa, Nedbank and Capitec layouts). The app:
  - detects the header row and columns, date formats (including Excel dates and yyyymmdd), and R 1 234,56 / Dr / Cr / negative amounts
  - tells money out from money in, using the running balance in PDFs
  - opens password-protected PDFs (it asks for the password)
- **Your own spreadsheets**, including ones with a Category column. Your category names are mapped to Rands categories.
- **Budget sheets** (Category + Amount): these set per-category budgets. Workbooks with several tabs let you pick the tab.
- **Auto-categorisation:** about 150 SA merchants are recognised (Woolies, Checkers, Engen, Nando's, Vodacom, Dis-Chem…). When you change a category, every similar merchant changes with it, and the app remembers the choice for future imports.
- **Duplicates:** expenses already in Rands are flagged and left unticked.
- **Manual mapping:** if detection gets a column wrong, open "Columns detected" and remap it by hand.
- **Not supported:** old .xls files (save them as .xlsx or .csv first) and scanned image PDFs.

## Install / update on your iPhone (GitHub Pages)
1. Upload **everything** in this folder, all files sit in one folder, so they can be uploaded together from your phone, to your `rands` repo.
2. Go to Settings → Pages → Source: *Deploy from a branch* → `main` / `(root)`.
3. Open `https://<username>.github.io/rands/` in Safari, then tap Share → Add to Home Screen.
4. Updating: replace the files. The app fetches new versions automatically when it's online.

Your existing (unencrypted) Rands data is encrypted automatically the first time you set a passcode.

Local test: `python3 -m http.server 8000` in this folder, then open http://localhost:8000

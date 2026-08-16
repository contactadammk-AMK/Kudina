# Kudina application — Full Deployment Guide (Plain Language)

This is everything you need to take Kudina from "files on a computer" to "a real, working website people can use." No coding knowledge assumed — every step says exactly what to click and where to find it.

**Read this once, top to bottom, before touching anything.** It's long because it's honest — every account you need, every button you click, every thing that commonly goes wrong.

---

## What you're actually deploying

Three websites, sharing one backend:

| What | Address (once live) | Who it's for |
|---|---|---|
| **Marketing site** | `kudina.app` (your domain) | Anyone — explains Kudina, lets people install it |
| **Trader app** | `kudina.app/app` | Market traders — sales, savings, wallet, score |
| **Lender portal** | `kudina.app/lender` | Banks/cooperatives — check a trader's score |

Behind all three sits **one database** (Supabase) and **background code** (on Vercel) that talks to two outside companies: **Monnify** (handles real money) and **VTpass** (handles data/airtime/bill purchases).

You do NOT need to touch Monnify or VTpass to get the basic app live. Those are Steps 4 and 5 below — the trader/lender score-sharing system works completely on its own without them.

---

## Before you start: accounts you'll need

Create these as you reach them in the steps below — don't rush to sign up for all five right now.

1. **GitHub** (github.com) — free. Where your files live so Vercel can find them.
2. **Vercel** (vercel.com) — free tier is enough to start. This is what actually puts your site on the internet.
3. **Supabase** (supabase.com) — free tier is enough to start. This is your database (where every trader, sale, and score gets stored).
4. **Monnify** (developers.monnify.com or via moniepoint.com) — needed only if you want the Wallet feature (funding, withdrawals) working.
5. **VTpass** (vtpass.com) — needed only if you want traders to buy data/airtime/pay bills.

---

## STEP 1 — Create the database (Supabase)

This is where every trader's data actually lives.

1. Go to **supabase.com** → sign up → **New project**.
2. Give it a name and a password (save the password somewhere — you likely won't need it again, but keep it).
3. Wait a minute or two for it to finish setting up.
4. In the left sidebar, click **SQL Editor**.
5. Open the file `supabase/schema.sql` from this project, select all of it, copy it.
6. Paste it into the SQL Editor and click **Run**. This builds every table Kudina needs — traders, wallets, transactions, everything. You'll see a success message.
7. In the left sidebar, click **Settings → API**. You need two things off this page, copy them somewhere safe:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **service_role secret key** — a long string under "Project API keys"

⚠️ **That service_role key is powerful — it can read and change anything in your database.** It only ever goes into Vercel's settings in Step 2. Never paste it into any `.html` file, never share it publicly, never put it in a chat message to anyone you don't fully trust.

---

## STEP 2 — Put the app online (Vercel)

1. Put every file from this project into a folder on your computer, keeping the folder structure exactly as given (the `api/`, `lib/`, `icons/` folders etc. must stay where they are).
2. Go to **github.com**, sign up if needed, create a **New repository** (keep it private if you'd like), and upload this whole folder to it.
3. Go to **vercel.com**, sign up (you can sign up directly with your GitHub account, which is easiest), click **Add New → Project**, and import the GitHub repository you just made.
4. **Before you click Deploy**, scroll to **Environment Variables** and add these two:
   - `SUPABASE_URL` → paste the Project URL from Step 1
   - `SUPABASE_SERVICE_ROLE_KEY` → paste the service_role key from Step 1
5. Click **Deploy**. Wait about a minute.
6. You'll get a working address like `https://kudina-yourname.vercel.app`. This is your live site right now.

---

## STEP 3 — Test that the core app works

1. On your phone, open `https://your-app.vercel.app/app`
2. Log a sale, add a Susu contribution, fill in your business profile — this is what builds up your score.
3. Go to **Profile tab → Cloud & sharing**, tap **Connect to cloud**.
4. Tap **+ Generate share code**. You'll get something like `7F3Q-9B2X`. Write it down.
5. Open `https://your-app.vercel.app/lender`, type in that code, tap **Check score**. You should see the score and business stats appear.
6. Go back to the trader app, tap **Revoke** on that code, then try checking it again on the lender page — it should now say it's invalid.
7. Open `https://your-app.vercel.app/` (just the plain address) — you should see the marketing site with the animated score wheel.

**If all of this worked, the foundation is solid.** Everything below is optional extra power — money, data/bills, and the Play Store. The app is already genuinely useful without them.

---

## STEP 4 — Turn on the Wallet (real money in and out)

Skip this step entirely if you're not ready for traders to move real money yet — nothing else breaks if you leave it off.

1. Sign up as a business at **moniepoint.com** (Business) or directly at **developers.monnify.com**.
2. From your Monnify dashboard, collect these four things:
   - **API Key**
   - **Secret Key**
   - **Contract Code** (under Settings → Contracts)
   - **Settlement Account Number** (the account collections land in — under your dashboard's Settlement/Wallet section)
3. Back in Vercel → your project → **Settings → Environment Variables**, add:
   - `MONNIFY_BASE_URL` = `https://sandbox.monnify.com` (leave exactly like this for now — this is "practice mode" with fake money)
   - `MONNIFY_API_KEY` = (from step 2)
   - `MONNIFY_SECRET_KEY` = (from step 2)
   - `MONNIFY_CONTRACT_CODE` = (from step 2)
   - `MONNIFY_SETTLEMENT_ACCOUNT_NUMBER` = (from step 2)
   - `MONNIFY_PREFERRED_BANK_CODE` = `50515` (this makes every trader's wallet a Moniepoint account — leave as-is unless you have a specific reason to change it)
   - `CRON_SECRET` = any long random text you make up yourself (not from Monnify) — this is a password that stops strangers from triggering your app's automatic cleanup job. You can generate one at **randomkeygen.com**, or just type 30+ random characters.
4. In your **Monnify dashboard**, find the webhook settings and register this URL:
   `https://your-app.vercel.app/api/wallet/webhook`
   This is the single most important step — without it, money can arrive in a trader's wallet and the app will never find out. Top-ups will just silently not show up.
5. Redeploy on Vercel so the new settings take effect (Vercel usually does this automatically when you save environment variables — if not, go to Deployments and click **Redeploy**).

**Test it:** Wallet tab → Set up wallet → you should get a real-looking account number. Send a small test payment to it (Monnify's own sandbox documentation explains how to simulate a payment in practice mode). Within seconds, your balance should update in the app.

---

## STEP 5 — Turn on Data, Airtime, Electricity, Cable TV, Exam PINs

1. Sign up at **vtpass.com**.
2. From your VTpass dashboard, collect: **API Key**, **Public Key**, **Secret Key**.
3. In Vercel's Environment Variables, add:
   - `VTPASS_BASE_URL` = `https://sandbox.vtpass.com/api` (practice mode, same idea as Monnify)
   - `VTPASS_API_KEY`, `VTPASS_PUBLIC_KEY`, `VTPASS_SECRET_KEY` = from step 2
   - `VEND_DATA_MARKUP_PERCENT` = `5` (this is how much extra, as a percentage, gets added on top of the real cost when a trader buys a data bundle — this is your profit margin on data. 5 means 5%. Change it to whatever you want.)

**Test it:** Wallet tab → **+ Buy Airtime** → type a phone number (it should guess the network by itself) → enter an amount → confirm.

---

## STEP 6 — Going live with real money (only after testing sandbox works)

Do this ONLY after Steps 4 and 5 above actually worked in practice mode:

1. In Vercel, change `MONNIFY_BASE_URL` to `https://api.monnify.com`
2. Change `VTPASS_BASE_URL` to `https://vtpass.com/api`
3. Complete whatever business verification ("KYB" / go-live review) Monnify and VTpass ask for — they'll want to confirm you're a real, legitimate business before letting real money flow through their systems. This can take a few days.
4. Redeploy.

From this point on, every transaction is real money. Test carefully with small amounts first.

---

## STEP 7 — Put it on your own domain (optional, but recommended)

Right now your site lives at `kudina-yourname.vercel.app`. If you own `kudina.app` or `kudina.com` or similar:

1. Buy the domain from any registrar (Namecheap, GoDaddy, Whogohost, etc.) if you don't already own it.
2. In Vercel → your project → **Settings → Domains**, add your domain.
3. Vercel will show you one or two DNS records to add — go to wherever you bought the domain, find "DNS settings," and add exactly what Vercel shows you.
4. Wait a bit (usually minutes, occasionally a few hours) for it to activate. Vercel handles the security certificate (the padlock/https) automatically.

**Two things to update after switching domains:**
- Go back to your **Monnify dashboard** and update the webhook URL to use your new domain instead of the vercel.app one, or wallet top-ups will stop working.
- If any trader opened the app as a downloaded file instead of through your link, they may need to update the "Kudina cloud URL" field in their Profile tab manually.

---

## STEP 8 — Google Play Store

The technical groundwork (app icons, the file that makes it installable, etc.) is already built into this project. What's left is mostly account and paperwork:

1. Write a **privacy policy** and put it somewhere with a real web address — this is mandatory for any app on the Play Store, and doubly so for one that touches money and personal information like BVN. This part is on you to write (or ask for help drafting it) — it needs to accurately describe what Kudina actually collects and does with it.
2. Create a **Google Play Console** account — one-time $25 fee, needs a Google account.
3. Once your site is live on your real domain, install Google's own packaging tool:
   ```
   npm install -g @bubblewrap/cli
   bubblewrap init --manifest=https://your-domain.com/manifest.json
   ```
4. This creates an Android project and, the first time you build it, a signing key. Get the fingerprint from it:
   ```
   keytool -list -v -keystore android.keystore -alias android
   ```
5. Open the file `.well-known/assetlinks.json` in this project, and replace `REPLACE_WITH_YOUR_APP_SIGNING_SHA256_FINGERPRINT` with what you just got. Also double check the `package_name` in that file matches what Bubblewrap used (check the `twa-manifest.json` file it created).
6. Upload the updated `assetlinks.json` back to your site (redeploy) — this file is what proves to Android that you actually own the app and the website.
7. Run `bubblewrap build` — this produces a `.aab` file.
8. Upload that `.aab` file to Play Console, fill in the store listing (screenshots, description, etc.), submit for review.

If the command-line steps feel like too much, **pwabuilder.com** does the same thing through a website instead.

---

## Every environment variable, in one place

Set all of these in **Vercel → your project → Settings → Environment Variables**. Never in any file.

| Variable | Required for | Where to get it |
|---|---|---|
| `SUPABASE_URL` | Everything | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Everything | Supabase → Settings → API |
| `MONNIFY_BASE_URL` | Wallet | You set this yourself (sandbox or live address) |
| `MONNIFY_API_KEY` | Wallet | Monnify dashboard |
| `MONNIFY_SECRET_KEY` | Wallet | Monnify dashboard |
| `MONNIFY_CONTRACT_CODE` | Wallet | Monnify dashboard → Contracts |
| `MONNIFY_SETTLEMENT_ACCOUNT_NUMBER` | Wallet | Monnify dashboard |
| `MONNIFY_PREFERRED_BANK_CODE` | Wallet | Leave as `50515` |
| `CRON_SECRET` | Wallet | You make this one up yourself |
| `VTPASS_BASE_URL` | Data/airtime/bills | You set this yourself (sandbox or live address) |
| `VTPASS_API_KEY` | Data/airtime/bills | VTpass dashboard |
| `VTPASS_PUBLIC_KEY` | Data/airtime/bills | VTpass dashboard |
| `VTPASS_SECRET_KEY` | Data/airtime/bills | VTpass dashboard |
| `VEND_DATA_MARKUP_PERCENT` | Data/airtime/bills | You decide — this is your profit margin |

---

## What each file/folder actually does (plain terms)

```
index.html          The public marketing website (what people see at your main domain)
app.html            The trader app itself — sales, savings, wallet, score
lender.html         Where a lender/cooperative checks a trader's score
manifest.json        Tells phones "this can be installed as an app"
sw.js                Makes the app work offline and installable
icons/                App icons in every size needed
.well-known/          Proves to Android you own the site (for Play Store)
vercel.json           Deployment configuration for Vercel
package.json          Lists the one code library the backend depends on
.env.example           A template showing every setting you need — copy values into Vercel, not into a file

supabase/schema.sql   Builds every database table Kudina needs — run this once, in Step 1

lib/                  Shared backend code (not visited directly by anyone)
  auth.js               Checks a trader's device is really who it says it is
  scoring.js             The exact formula that calculates a vitality score
  supabaseAdmin.js       Connects the backend to your database
  rateLimit.js           Stops the lender score-checker from being spammed
  monnify.js              Talks to Monnify for wallet features
  vend/vtpass.js          Talks to VTpass for data/airtime/bills
  vend/router.js           Where a second data/bills provider could be added later
  vend/networkPrefixes.js  Figures out MTN/Airtel/Glo/9mobile from a phone number

api/                  Backend actions (each file = one thing the app can ask the server to do)
  sync.js                Saves/loads a trader's data to the cloud
  share-codes.js          Creates/checks/revokes lender share codes
  lender/verify.js        What actually runs when a lender checks a code
  wallet/create.js        Sets up a trader's Moniepoint account
  wallet/webhook.js        Listens for "money just arrived" from Monnify
  wallet/balance.js        Shows a trader their wallet balance and history
  wallet/withdraw.js       Sends money out of a trader's wallet
  wallet/banks.js           List of banks for the withdraw screen
  wallet/resolve-account.js  Double-checks a withdrawal destination's name
  wallet/attach-kyc.js      Links a trader's BVN to raise their limits
  wallet/reconcile.js        Automatic cleanup job for stuck transactions
  vend/catalog.js            Live prices for data/cable/exam bundles
  vend/purchase.js           Handles an actual data/airtime/bill purchase
  vend/verify-customer.js    Double-checks a meter/smartcard number before paying it
```

---

## How to know if something's broken (quick checklist)

- **App won't load at all** → check Vercel's deployment log for red error text; usually a missing environment variable
- **Trader app loads but Wallet tab errors** → `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` missing or wrong, or you haven't run `schema.sql` yet
- **Wallet balance never updates after a transfer** → the Monnify webhook URL isn't registered, or is pointing at the wrong domain
- **Can't buy data/airtime** → VTpass keys missing, or you're still on sandbox mode (fine for testing, but sandbox purchases aren't real)
- **Lender portal says a code is invalid immediately** → the trader hasn't tapped "Connect to cloud" in Profile first
- **App looks broken/blank on a phone that isn't yours** → almost always a browser cache issue on your end while testing, not a real bug — try a private/incognito tab

---

## Honest gaps — things not 100% finished

These won't stop the app from working, but are worth knowing about before you rely on them at real scale:

- **`resolve-account.js`** and **`verify-customer.js`** (the features that show "paying: JOHN DOE" before a bank withdrawal or bill payment) use provider endpoints that weren't double-checked against live documentation in one part of this build. They're designed to fail safely — if they can't verify a name, they just don't show one, they never block the actual transaction.
- **Electricity minimum amounts** aren't specific to each provider (some enforce higher minimums than others) — a too-low amount fails cleanly and refunds automatically rather than causing a real problem, it's just not caught with a specific error message yet.
- **The automatic stuck-transaction cleanup** runs every 15 minutes, but that speed needs Vercel's paid "Pro" plan ($20/month). On the free plan, change the schedule in `vercel.json` to run once a day instead.
- **No privacy policy exists yet** — you need to write one before submitting to the Play Store, and honestly, before real users hand over BVN/financial data regardless of app stores.

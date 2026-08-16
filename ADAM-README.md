# Kudina — Adam Readme (just follow along, in order)

## PART 1 — Get the site working

**1.** Open a web browser. Go to **supabase.com**
**2.** Click **Start your project**. Sign up.
**3.** Click **New project**. Give it any name. Click **Create new project**. Wait 1–2 minutes.
**4.** On the left side, click **SQL Editor**.
**5.** Open the file `supabase/schema.sql` from this project. Select all the text. Copy it.
**6.** Paste it into the SQL Editor box in Supabase. Click **Run**.
**7.** On the left side, click **Settings**, then click **API**.
**8.** Copy the **Project URL**. Paste it into a Notes app, label it `SUPABASE_URL`.
**9.** Copy the **service_role** key (click "reveal" if it's hidden). Paste it into Notes, label it `SUPABASE_SERVICE_ROLE_KEY`.

**10.** Open a new browser tab. Go to **github.com**. Sign up if you don't have an account.
**11.** Click the **+** icon top right. Click **New repository**. Name it `kudina`. Click **Create repository**.
**12.** On your computer, find the Kudina project folder. Upload every file and folder inside it to this GitHub repository (drag and drop them onto the GitHub page, or use "uploading an existing file").

**13.** Open a new browser tab. Go to **vercel.com**. Click **Sign Up**. Choose **Continue with GitHub**.
**14.** Click **Add New**, then **Project**.
**15.** Find `kudina` in the list. Click **Import**.
**16.** Click **Environment Variables** to open it.
**17.** In the "Name" box type `SUPABASE_URL`. In the "Value" box paste what you saved in step 8. Click **Add**.
**18.** In the "Name" box type `SUPABASE_SERVICE_ROLE_KEY`. In the "Value" box paste what you saved in step 9. Click **Add**.
**19.** Click the big **Deploy** button. Wait 1–2 minutes.
**20.** Click **Continue to Dashboard**. Copy the web address shown (it ends in `.vercel.app`).

**Your site is now live.** Open that address in your phone's browser to see it.

---

## PART 2 — Check it actually works

**1.** On your phone, open your browser. Go to `[your address].vercel.app/app`
**2.** Tap **+ Sale**. Fill it in. Tap **Save**.
**3.** Tap the **Profile** tab. Tap **Cloud & sharing**. Tap **Connect to cloud**.
**4.** Tap **+ Generate share code**. Write down the code shown (looks like `7F3Q-9B2X`).
**5.** Open a new browser tab. Go to `[your address].vercel.app/lender`
**6.** Type in the code from step 4. Tap **Check score**.
**7.** You should see a score appear. If you do, everything is working.

---

## PART 3 — Turn on real money (only if you want the Wallet to work)

**1.** Open a browser. Go to **developers.monnify.com**. Sign up as a business.
**2.** Find and copy these 4 things from your Monnify dashboard, save each in Notes: **API Key**, **Secret Key**, **Contract Code**, **Settlement Account Number**.
**3.** Go back to **vercel.com**. Open your `kudina` project. Click **Settings**, then **Environment Variables**.
**4.** Add each of these one at a time (click **Add** after each):
   - Name: `MONNIFY_BASE_URL` — Value: `https://sandbox.monnify.com`
   - Name: `MONNIFY_API_KEY` — Value: (paste from step 2)
   - Name: `MONNIFY_SECRET_KEY` — Value: (paste from step 2)
   - Name: `MONNIFY_CONTRACT_CODE` — Value: (paste from step 2)
   - Name: `MONNIFY_SETTLEMENT_ACCOUNT_NUMBER` — Value: (paste from step 2)
   - Name: `MONNIFY_PREFERRED_BANK_CODE` — Value: `50515`
   - Name: `CRON_SECRET` — Value: type any 30 random letters and numbers yourself
**5.** Go back to your Monnify dashboard. Find "Webhooks". Paste this in, replacing the bracket part with your real address: `https://[your address].vercel.app/api/wallet/webhook`
**6.** Go back to Vercel. Click **Deployments**. Click the three dots on the newest one. Click **Redeploy**.
**7.** On your phone, open the app. Tap **Wallet**. Tap **Set up wallet**. You should get an account number.

---

## PART 4 — Turn on data/airtime/bills (only if you want this)

**1.** Open a browser. Go to **vtpass.com**. Sign up.
**2.** Find and copy these 3 things from your VTpass dashboard: **API Key**, **Public Key**, **Secret Key**.
**3.** Go to **vercel.com**. Open your project. Click **Settings**, then **Environment Variables**.
**4.** Add each one:
   - Name: `VTPASS_BASE_URL` — Value: `https://sandbox.vtpass.com/api`
   - Name: `VTPASS_API_KEY` — Value: (paste from step 2)
   - Name: `VTPASS_PUBLIC_KEY` — Value: (paste from step 2)
   - Name: `VTPASS_SECRET_KEY` — Value: (paste from step 2)
   - Name: `VEND_DATA_MARKUP_PERCENT` — Value: `5`
**5.** Click **Deployments**. Click the three dots on the newest one. Click **Redeploy**.
**6.** On your phone, open the app. Tap **Wallet**. Tap **+ Buy Airtime**. Try it.

---

## PART 5 — Go live with real money (only after Part 3 and 4 actually worked)

**1.** Go to **vercel.com**. Open your project. Click **Settings**, then **Environment Variables**.
**2.** Find `MONNIFY_BASE_URL`. Click the three dots next to it. Click **Edit**. Change the value to `https://api.monnify.com`. Click **Save**.
**3.** Find `VTPASS_BASE_URL`. Click the three dots. Click **Edit**. Change the value to `https://vtpass.com/api`. Click **Save**.
**4.** Click **Deployments**. Click the three dots on the newest one. Click **Redeploy**.

**Done. Everything is now live for real.**

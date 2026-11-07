# Budget Up — Product Spec

**Budget Up** is a shared budgeting app for two (or more) people, installable on a phone as a Progressive Web App (PWA). All money is in **Israeli shekels (₪)**. Everyone you share a budget with can add and update the same data from their own device.

This document records everything requested, followed by the decisions made where the request left room.

---

## 1. Goals

- Track **income** and **expenses** quickly from a phone.
- Share a budget with a partner (or anyone) so both can add and edit it from their own devices.
- See what has been spent so far at any moment, by month or year, by category.
- Calculate **מעשר (maaser / charity)** automatically as 10% of income, and track what has been given.
- Get a **summary email on the 1st of every month** for the month that just ended.
- Look and feel like a native app when saved to the home screen, with a **sleek, professional, easy-to-understand** design.

## 2. Platform

| Requirement | How |
|---|---|
| Opens on a phone and looks like an app | Progressive Web App: web manifest, service worker, standalone display, safe-area aware |
| Home-screen icon | A yellow rubber duck with dollar-sign (`$`) eyes (`public/icons/`). PNG icons at 192, 512, maskable 512 and an Apple touch icon at 180 so it works on both Android and iOS |
| Same data on every device | Cloudflare Worker API + D1 (SQLite) database |
| Stay logged in | A long-lived, rolling session cookie (365 days, refreshed every time the app opens) |
| Name | **Budget Up** |

## 3. Accounts & sign-in

- Sign up and log in with **username + password**.
- Signup also takes a display name (used in "Hey Eli") and an **optional email** (used for the monthly summary).
- A user stays signed in on the same device until they choose **Log out**.
- Passwords are stored only as salted PBKDF2-SHA256 hashes. Repeated failed logins are rate-limited.
- Changing the password signs out the user's other devices.

## 4. Budgets ("ledgers") and sharing

A user can belong to **several completely separate budgets**, for example *"Eli's family"* and *"Parents"*. Each has its own entries, categories, defaults and maaser.

- **Top-right of every screen**: `Hey Eli` with the **current budget's name** beneath it. Tapping it lists every budget the user can access and lets them switch, or create a new one.
- A new account gets a personal budget named *"<Name>'s budget"* (unless they signed up through an invite link).
- **Inviting someone**: Settings → Sharing & budgets → *Invite someone* creates a link (valid 14 days) that can be copied or shared with the phone's share sheet.
  - Opening the link **without an account** → the person creates one, and is added to the budget.
  - Opening it **with an account** → they confirm and get access to that budget.
- There is no view-only role: everyone invited gets **full access** (by design).
- Everyone in a budget can see, add, edit and delete entries and categories. The **owner** (creator) can additionally rename or delete the budget and remove people. Members can leave.
- Invite links can be revoked. Each entry records **who added it**.
- Non-members cannot see or fetch a budget's data at all.

## 5. Main screen

Top bar: menu button (☰), the duck logo + *Budget Up*, and the **Hey <Name> / current budget** switcher on the right.

Body:

1. A summary card for the current month: **Income**, **Spent**, **Balance**, color-coded.
2. Two big buttons:
   1. **Income** — opens a form: **amount**, optional **comment**, date (defaults to today) → **Save**.
   2. **Expense** — opens a form: **category**, **amount**, optional **comment**, date → **Save**.
3. A link showing the **מעשר left to give**.
4. The latest entries this month (tap one to edit).

On wider screens the sidebar is permanently visible.

## 6. Categories

### 6.1 Main categories with no subcategories (shown on their own)
Rent · Bills · Medical · SIM · WIFI · Transportation · Gifts to others · Clothes · Household

### 6.2 Main categories with subcategories

| Main category | Subcategories |
|---|---|
| **Food** | Shopping, Restaurants, Snacks, Treats |
| **Hygiene** | Beauty, Toiletries |

### 6.3 Rules
- **When adding an expense**, the picker offers the standalone categories **and the subcategories** (grouped under their main category). A main category that has subcategories is not itself picked — you pick the specific subcategory (e.g. *Shopping*).
- **When viewing**, subcategories roll up under their main category: Food shows **₪1,000**; tapping it reveals *Shopping ₪800, Snacks ₪200*.
- Categories are depth-limited to two levels (main → sub).

## 7. Viewing spending

Sidebar → **View**.

- Choose **Month** or **Year**. Month uses previous/next arrows or a picker; Year shows a **month-by-month table** (tap a month to jump to it).
- A control at the top picks **what to see**: **Everything**, **Expenses only**, **Income only**, or **Choose…** (a checklist of specific categories/subcategories).
- Every category is listed with how much was spent in it, including those with subcategories (zero-spend categories shown dimmed). Each main row has a small bar showing its share of total spending.
- **Tap a main category with subcategories** → expands to show its subcategories (smaller, indented, lighter). *See all <category> entries* lists everything in the group.
- **Tap a category or subcategory** (the standalone ones, or any subcategory) → a sheet listing **exactly what was spent** in it: date, comment, who, amount. Tapping an entry lets you edit or delete it.
- Visual hierarchy: main categories are larger/bolder; subcategories are slightly smaller and indented; entries are distinct cards with a colored edge and date chip.

## 8. Editing mistakes

- Sidebar → **Edit entries**: pick a **month**, search (by comment, category, person, amount), filter by income/expenses, tap an entry to **change or delete** it.
- Entries can also be edited from the Home list and from the View drill-downs.

## 9. מעשר — Maaser (charity)

The UI label is **מעשר** (Hebrew), with *Maaser* beside it for clarity.

- **Maaser owed = 10% of income** over the **last 12 months**.
- If the budget has existed for **fewer than 12 months**, only the months since it started are counted (e.g. 2 months → just those 2).
- **Left to give** = owed − charity given. A **Give מעשר** button records an amount (with date and optional comment), which reduces what's left.
- **Giving extra**: the value is allowed to go **below zero**. The extra is remembered as a credit, so it reduces what's owed in the future instead of being lost.
- Precisely: `left = 10% × income(window) − given(window) − credit`, where `credit` is surplus from before the window (money given beyond 10% of income back then). Old *unpaid* amounts age out of the 12-month window; old *surplus* never does.
- The page shows the breakdown (income counted, owed, given, extra credit, left) and the list of gifts, which can be removed if entered by mistake.

## 10. Default (recurring) income and expenses

Settings → **Make default expenses**.

- Add a default expense (category + amount + optional comment) — e.g. *Rent ₪4,500*, *Bills ₪800* — and a default income (e.g. *Salary*).
- They are **added automatically on the 1st of every month** and counted in totals. When created they also apply to the current month immediately.
- Defaults can be **edited, deleted, or added to** at any time. Changing a default affects future months; entries already generated stay as they are and can be edited individually (they're tagged *auto*).
- Generation is idempotent — a default is never added twice for the same month, and if you delete an auto-added entry it is not re-created.

## 11. Settings

- **Categories** — add or rename categories, add subcategories under a main category, **turn a main category into a subcategory** (move it under another), promote a subcategory to a main category, and remove categories. Removing archives a category: it disappears from pickers but past entries keep it in reports.
- **Make default expenses** — see §10.
- **Sharing & budgets** — members, invite links, rename / switch / create / leave / delete budgets.
- **Account** — name, email, monthly-email toggle and **day of month**, *send me last month's summary now*, change password.

## 12. Monthly summary email

Each user with an email address receives the summary of the **previous calendar month** once a month, at ≈ 07:00–08:00 Israel time. **By default this is the 1st.** In Settings → Account each user can choose a different **day of the month (1–31)**. If a month is shorter than the chosen day (e.g. 31 in a 30-day month), it is sent on that month's **last day**. The email looks like:

> **Hi Eli, here is your budget summary from March 2026:**
> Income · Expenses · Balance, then **Expenses by category** — each main category with its total and its **subcategories** underneath — and the maaser status.
> **Budget well!**

- It contains **categories and subcategories only — never the list of individual purchases.**
- If the user belongs to several budgets, each gets its own section in the one email. Budgets with no activity that month are skipped.
- Users can turn it off, or change the day, in Settings → Account. Each user receives each month's summary at most once.
- Delivery uses **Gmail SMTP** (an app password stored as a Worker secret, so no domain is needed); Resend is supported as an alternative.

## 13. Hebrew + English

- The interface is in English, with **מעשר** shown in Hebrew.
- Direction is handled per piece of text: fixed Hebrew labels use `lang="he"` / `dir="rtl"` in isolated `<bdi>` runs, user-entered text (comments, names, category names) uses `<bdi>`/`dir="auto"`, and amounts are forced left-to-right and isolated. Hebrew and English can therefore sit in the same line without reordering each other or the numbers.

## 14. Design

- **Sleek and professional, but friendly.** Rounded cards, generous spacing, system fonts (with Hebrew support), light and dark themes (follows the device).
- **Colored numbers**: income **green**, expenses **red/coral**, balance **blue** (red when negative), maaser **purple**.
- Clear three-level hierarchy: **main categories** (large, bold) → **subcategories** (smaller, indented, muted) → **entries** (cards).
- Mobile-first with a slide-in sidebar; persistent sidebar on desktop. Large tap targets, bottom sheets for forms.
- Yellow duck logo in the top-left corner of the app bar.

## 15. Data model (summary)

`users`, `sessions`, `ledgers`, `members`, `invites`, `categories` (self-referencing `parent_id`), `transactions` (`type` income/expense, integer agorot), `defaults` + `defaults_applied`, `maaser_gives`, `summary_log`. Money is stored as **integer agorot** to avoid floating-point errors.

## 16. Security & privacy

- Per-budget access checks on every request (non-members get 404).
- JSON-only mutation API with SameSite cookies (CSRF-resistant); HttpOnly + Secure session cookie.
- All user-supplied text is HTML-escaped before rendering.
- The public repo contains code only; no budget data or secrets are committed. The email provider key is a Worker secret.

## 17. Out of scope for v1 / future ideas

- Real-time push notifications (the monthly email covers the "end of month summary").
- Per-category budgets / limits, charts, CSV export, receipts.
- Multiple currencies.
- Password reset by email.

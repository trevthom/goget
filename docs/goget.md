# GoGet — user guide

**You go. We get.**

GoGet is one app with four ways to use it. You log in once. Then you pick a *context*:

| Context | What you do | Built from |
|---|---|---|
| **Taxi Driver** | Take riders where they want to go. Get paid in ecash as the ride runs. | The NostrRide driver app, unchanged |
| **Passenger** | Ask for a ride. Pay the driver as the ride runs. | The NostrRide rider app, unchanged |
| **Courier** | Carry parcels. Bid on delivery requests. | New in GoGet |
| **Shipping** | Send a document, a package or heavy equipment. Pick a courier's bid. | New in GoGet |

You can change your context at any time: **Account → Switch role**. Your account, wallet, vouches and settings stay the same in every context. GoGet remembers your last choice on each device.
You cannot switch while a ride or a delivery is running. Finish it first.

This guide explains every part of GoGet. For the technical details of the ride system, read [`index.md`](index.md). For how the code is built, read [`../CLAUDE.md`](../CLAUDE.md).

---

## 1. What makes GoGet different

- **No company in the middle.** There is no server and no account database. People talk to each other through *Nostr relays*. Every action is a signed message.
- **Permissionless.** Anyone can join, post, bid, drive or carry. Nobody approves you. Nobody can switch you off.
- **Unregulated.** GoGet does not check licenses, insurance, identity or goods. A CDL is something a courier *says*. GoGet cannot prove it. Read [Trust and safety](#9-trust-and-safety).
- **Paid in ecash.** Ecash (Cashu) is digital cash held at a *mint*. It is private, instant and has no bank. You can add money with Lightning and cash out to Lightning.
- **No ratings.** Star ratings are easy to fake. GoGet uses *vouches* instead: "I know and trust this person."

---

## 2. Getting started

1. Open GoGet. Create a new key, or log in with a key you already have (`nsec…`). **Write your key down.** Nobody can recover it for you.
2. Optional: tick *Remember me*. Your key is then saved on the device, locked with a password. The password page has a show/hide eye.
3. Pick a context.
4. Go to **Account → Ecash wallet** and add money (**Add funds**). You pay a Lightning invoice and the app collects the ecash. Passengers and shippers need money before they ride or accept a bid. Taxi drivers and couriers receive money here.
5. Write down your **12 recovery words** (Account → Recovery phrase). They bring your ecash back if you lose the phone.

---

## 3. Account (every context)

Every setting is a section you tap open. The sections are the same in all contexts, with a few extras:

| Section | What it does |
|---|---|
| **Switch role** | Change context. |
| **Appearance** | Dark Mode (application), Dark Mode (map) and Units (kilometers). Each switch saves at once. |
| **Wallets** | The currency, then the ecash wallet and the cash out location. |
| &nbsp; *Ecash wallet* | A new phone has no wallet: **Create New Wallet** (a warning, then the 12 words) or **Restore my wallet** (the 12 words from another phone). Then balance, add funds, **Send** (an ecash token or a Lightning payment), the mint you use, paste an ecash token you were sent, back up. Drivers and couriers also get **Cash out** and **Automatically cash out at: $**. |
| **Gender (optional)** | Taxi drivers and couriers may set it. It only changes the order of someone's list; nobody is hidden. |
| **Recovery phrase** | The 12 words that restore your ecash on a new phone. |
| **Contact methods** | How the other person can reach you during a job (Signal, Telegram, phone…). |
| **Your vouches** | The people you know and trust. See [Vouches](#8-vouches). |
| **Blocked people** | People you never want to deal with. They do not see you either. |
| **Nostr relays** | The relays GoGet talks to. You can add your own. |
| **Your keys** | Show or copy your keys. Keep the secret key secret. |

---

## 4. Passenger and Taxi Driver

These two contexts are the NostrRide rider and driver apps. They work exactly as before.

**Passenger:** *Where to?* → pick a pickup and a drop-off → see each driver's own rates → *Request ride* → choose a driver → check the car → type the 4-digit code the driver shows → ride → *Finish ride*. You pay in small ecash payments (a base rate, each mile, each minute) while the ride runs. There is no deposit and no cancel fee. You can add a stop or change the destination (*Add stop / update fare*). You see your ecash balance live.

**Taxi Driver:** finish your profile (photo, car, plate) → *Go online* → accept requests → drive to the pickup → *I've arrived* (within 150 m) → show the 4-digit code → *Finish ride*. You set your own rates. Payments arrive as you drive.

The full description is in [`index.md`](index.md).

---

## 5. Shipping (send something)

### Post a delivery (Ship tab)
1. **What are you sending?** Document, Package, Large equipment, or Something else.
2. **How big is it?** Small (fits in a bag), Medium (a box), Large (needs a van or truck), Oversize / heavy (needs a flatbed, trailer or equipment).
3. **Tell couriers about it.** Weight, what it is, anything special. Couriers near you can read this. Leave out private details.
4. **Where?** Choose the pickup and the drop-off. Type an address or a business name, or pin the spot on the map. The search shows your three most recent pickups and drop-offs.
5. **When?** *As soon as possible*, or *Later* with a date and time (up to 90 days ahead).
6. **Does the courier need a CDL?** Tick the box, and pick the endorsements the courier must hold: H (hazmat), N (tank), P (passengers), S (school bus), T (double/triple trailers), X (tank + hazmat). A courier who does not have them **never sees your request**.
7. **Who should the courier ask for?** An optional note: a name, a phone number, a gate code. Only the courier you choose can read it.
8. Tap **Post delivery request**.

A request stays open for 12 hours (ASAP), or until 12 hours after the pickup time (later). Nobody takes it? It expires by itself.

### Bids tab
Couriers bid. Each bid shows the courier's photo and name, your vouch badge (if your vouches know them), the price, how soon they can be at the pickup, what they drive, their CDL statement, and their notes.
- The tab shows a **number** when bids are waiting. Nothing has to be decided at once.
- **Accept** a bid: GoGet asks you to confirm. **All other bids on that delivery are declined at once.** You need enough ecash at the courier's mint (the price plus 1% for mint fees). If you are short, GoGet offers *Add funds*.
- **Decline** a bid: only that bid is turned down. The request stays open.

### Deliveries tab
Your deliveries, running ones first. Tap one to open it:
- **Waiting for bids** — see the bids, or close the request. Nothing was charged.
- **Courier on the way** — you see the courier on the map. When the courier takes the parcel, ask for the **4-digit code on the courier's phone** and type it. That tells GoGet the parcel changed hands, and the *pickup share* is paid.
- **On its way** — you see the courier on the map.
- **Delivered** — you see the courier's photo and how far from the drop-off it was taken. Tap **Parcel received** to pay the rest, or **Report a problem**.
- **Completed**, **Closed**, **Expired** — the end states. *Post it again* fills the form with the same details.

---

## 6. Courier (carry parcels)

### Set up (Account → Courier details)
- **I have a CDL.** Tick the box and tap the endorsements you hold. This shows on **every bid** you send.
- **What do you drive?** For example "Cargo van" or "16 ft box truck with lift gate". It shows on your bids too.
- Add a profile photo. Shippers trust people they can see.
- Keep your ecash wallet connected. You are paid in ecash.

This is your own statement. GoGet does not check it. If you say you hold something you do not, you break the trust people place in you, and maybe the law. See [Trust and safety](#9-trust-and-safety).

### Jobs tab
Open delivery requests near you. Nearest first. You choose how far: 10, 25, 50 or 100 miles. Requests that need a CDL or an endorsement you did not list are **not shown at all**. Your own requests and requests from people you blocked are hidden.
Tap a request to read it and bid:
- **Your price** — in your currency or in sats.
- **Minutes until you can be at the pickup.**
- **Paid when the shipper hands you the parcel** — 0%, 25%, 50% or 75% (default 50%). The rest is paid when the parcel arrives.
- **Notes for the shipper** — anything useful: *I have a lift gate. I can carry it inside.*
You can change your bid or take it back until the shipper chooses.

### My jobs tab
- **Deliveries** — the jobs the shipper gave you. A number on the tab shows how many.
- **My bids** — waiting, chosen, declined (the shipper turned it down, or took another bid), or expired.

### Doing a job
1. Open the job. You now see the **exact addresses** and the shipper's note. *Open in a maps app* starts navigation.
2. At the pickup, show the **4-digit code** on your screen. The shipper types it. You type nothing. The pickup share is paid to you at once.
3. Drive to the drop-off. GoGet sends your position, encrypted, to the shipper only.
4. At the drop-off (within 300 m, with a good GPS fix), tap **Mark delivered**. You can add a photo of the parcel. The photo is sealed so only the shipper can see it.
5. The shipper confirms. The rest is paid to you.
You can **withdraw** before the pickup. Nothing is charged, and the shipper is told. After the parcel changed hands, you cannot drop the job.

### Earnings tab
Today, 7 days and all time, and the list of completed deliveries.

---

## 7. How a delivery is paid

- The price is the **accepted bid**, in sats. Nothing can change it later.
- It is paid in **two parts**, by the shipper's app, in ecash, at the courier's mint:
  1. the *pickup share* (the courier chose 0–75%) — when the shipper types the code;
  2. the *rest* — when the shipper taps **Parcel received**.
- There is **no escrow and no deposit**. Each side carries part of the risk, so neither carries all of it.
- If the shipper's wallet is short, the app pays what it can and the rest stays due. The shipper sees *Add funds*.
- A shipper who reports a problem holds the final payment. Nobody can force a payment: GoGet has no judge. See below.

---

## 8. Vouches

A vouch means "I know and trust this person." Add people under **Account → Your vouches** (paste their `npub`). Your vouch list is public.
When you look at a courier, a shipper, a driver or a passenger, GoGet shows **"N of your vouches know and trust this person"**. It counts only people *you* chose. It goes one step and no further. If it shows nothing, none of your vouches know them.
There are no stars and no reviews.

---

## 9. Trust and safety

GoGet is permissionless and unregulated. That is the point. It also means **you are responsible for your own safety and your own choices**.

- GoGet does **not** verify identity, licenses, insurance, vehicles, goods or addresses. A CDL, an endorsement or a vehicle is the courier's word.
- GoGet has **no support desk, no arbiter and no refunds**. If a parcel is lost, damaged or never paid for, there is no one to appeal to inside GoGet.
- Use the **vouch badge**, the **photo**, the courier's **notes** and your own judgment.
- Start small. Send low-value parcels to people you do not know yet. Pay a small *pickup share*.
- **Do not send illegal, dangerous or restricted goods.** Local law still applies to you, to the courier and to what you carry. Hazardous materials need the right training and endorsement in the real world; GoGet cannot check this.
- **Meet in public** when you can, and tell someone where you are going. Passengers can share a trip with a trusted contact.
- You can **block** anyone. They are not told. They no longer see your requests, bids or car.

---

## 10. Privacy

- **Every job event is sealed.** Requests, bids, accepts, stages, confirmations and payments go out only inside encrypted "gift wraps" (Nostr kind 1059). A relay sees a throwaway sender, the person who receives the wrap, and the time. It does not see the kind of event, the places, the description, the price or the CDL need.
- A request is sent only to the **couriers (or drivers) who are online near the pickup**, and only to couriers whose CDL meets the need. A courier or driver who comes online later gets the request when your app next sees them, so keep the app open while you wait for bids.
- The request still carries only the **area** of the pickup and the drop-off (about 1 km) for the couriers who receive it. The **exact addresses and your contact note are sealed** to you, and go to the courier only after you accept that courier's bid.
- The courier's **live position** is encrypted and goes only to the shipper of that job.
- The **photo** of a delivery is encrypted to the shipper.
- Payments are sealed to the person being paid. The amount is no longer visible to a relay.
- What a relay can still see: who receives each wrap and when, how big it is, and the things that are public on purpose: online presence (coarse, about 100 m), vouch lists and profiles. Some relays refuse or do not keep kind 1059; use relays that do (Account → Nostr relays).
- Your **miles driven** are kept in your own profile, because other people can no longer count them from public events.
- Your **recovery words** and **secret key** never leave your device.

---

## 11. Connection and reliability

- GoGet keeps working through short drops: events wait in an outbox and are sent again.
- Keep the screen on while a job runs. A phone that sleeps cannot pay or redeem payments. GoGet asks the browser to keep the screen awake.
- A request, bid or payment you make while offline is sent when the network returns.
- GoGet is a web app. You can install it on a phone's home screen.

---

## 12. Limits (what GoGet does not do yet)

- No in-app chat or calls. Use *Contact methods*.
- No push notifications while the app is closed. Open the app to see new bids and jobs.
- No insurance, proof of delivery beyond a photo and the shipper's confirmation, or dispute service.
- No multiple-parcel loads, pallets with several drop-offs, or recurring deliveries.
- No tips for couriers in this version.
- A courier cannot see the shipper's earlier deliveries, only the shipper's vouch badge.
- Automatic cash out works for Taxi Drivers (Account → Ecash wallet). Couriers can cash out by hand.

---

## 13. Frequently asked questions

**Can I use all four contexts with one account?** Yes. Switch in Account.

**Can I be a courier and a shipper at the same time?** Yes, but you see one context at a time. Finish a running job before you switch.

**Why can't I see a request?** It may need a CDL or an endorsement you did not tick, it may be outside your distance, it may be expired or taken, or the shipper may have blocked you.

**What if the courier never shows up?** Before the pickup nothing was charged. Close the request and post it again.

**What if the shipper never confirms?** The courier already holds the pickup share. The courier can contact the shipper, and can leave a note on his own profile. There is no forced payment.

**What if my ecash mint disappears?** Ecash is only as safe as the mint. Use a mint you trust and keep little in the wallet. Cash out often.

**Is my money safe?** Your ecash is stored on your device, encrypted. Your 12 words restore it. Lose both the phone and the words, and the money is gone.

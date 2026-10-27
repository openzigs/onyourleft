# On Your Left — deleting your account

This page is for the **On Your Left** app (`dev.openzigs.onyourleft` on Google Play), and says how to
delete your account on an instance and the data that goes with it. The
[privacy policy](privacy-policy.md#deleting-your-data) is the full account of what the app keeps and
where.

**Your rides are on your device, and there is no account unless you connect the app to an
instance.** An instance is a server you choose to connect to. Connecting creates your account on it.
That account, and everything that instance holds about you, is what this page is about.

## Delete your account from the app

1. Open the app, and go to the **Instance** screen.
2. While this device is signed in to the instance, press **Delete my account on this instance**.
3. Read what it deletes, and press **Delete it**.

The instance deletes your account at once. The app asks with a statement signed just then by this
device's key, as well as its sign-in, so a sign-in taken from your device is not enough to delete
your account. If your account there was suspended, the same button is under **Decisions about your
account**, on the same screen.

## Ask for it to be deleted, without the app

If you no longer have the app, or it can no longer sign in to the instance:

- **For the project's own instance**, email **[matt@openzigs.ai](mailto:matt@openzigs.ai)**, the
  maintainer who runs it. Say which name you used there and roughly when you connected. Do not put
  a request about your own data in a public issue.
- **For anybody else's instance**, ask whoever runs it. This project cannot reach another instance's
  data, and cannot delete it for you.

## What is deleted, and what is kept

**Deleted:** your account on that instance and everything it holds about you. That means your device
keys there, your name and any earlier names, everything you synced, and the searchable copy and the
analyses it keeps for you. It also means any key of yours it holds, your agreement to a service, and
your words to mask and privacy zones. Which rooms you made or joined is deleted too: every room you
made ends, and its route is deleted. Your race results go, and the other riders in those races see
you as "a rider".

**Kept:**

- **The instance's moderation log**, the record of what its moderators did and to whom, which the
  instance keeps as its audit trail.
- **Everything on your device.** Deleting your account on an instance deletes nothing on your
  device: every ride stays there, and the device forgets the instance as *Disconnect* does. To
  delete what is on the device, use **Files → Erase this device**, or uninstall the app.
- **Copies elsewhere**, which deleting your account cannot reach: a file you exported, a copy anybody
  already saved, another instance, or a service you agreed to that your instance sent something to.
- **Cloudflare's record of recent requests** to the project's own instance — your IP address, the
  time, and your device or browser type. Our Cloudflare account can see it for up to 7 days, and we
  cannot delete it on request.

# Hostinger VPS এ লাইভ করার নিয়ম

## ১. VPS কিনুন
- Hostinger → VPS Hosting → **KVM 2** (২ vCPU, ৮ GB RAM) যথেষ্ট। ভিডিও বেশি হলে বেশি স্টোরেজের প্ল্যান নিন (৭২০p তে ১ ঘণ্টার ভিডিও মোটামুটি ৩০০–৫০০ MB)।
- অপারেটিং সিস্টেম: **Ubuntu 24.04** (কোনো প্যানেল ছাড়া, "Plain OS")।
- root পাসওয়ার্ড সেট করুন আর সার্ভারের IP টুকে রাখুন।

## ২. ডোমেইন সার্ভারের দিকে ঘোরান
ডোমেইনের DNS এ একটা **A record** দিন: `@` (বা `class` এর মতো সাবডোমেইন) → আপনার VPS এর IP। ৫–৩০ মিনিট লাগতে পারে।

## ৩. সার্ভারে ঢুকে ইনস্টল করুন
Hostinger প্যানেলের **Browser terminal** খুলুন (বা নিজের কম্পিউটার থেকে `ssh root@IP`), তারপর:

```bash
apt-get update && apt-get install -y git
git clone https://github.com/<আপনার-ইউজারনেম>/classvault.git
cd classvault
bash deploy/install.sh class.yourdomain.com you@email.com
```
রিপো প্রাইভেট হলে git clone এর সময় GitHub ইউজারনেম আর একটা Personal Access Token চাইবে।

শেষে স্ক্রিনে অ্যাডমিন পাসওয়ার্ড দেখাবে, সেটা সংরক্ষণ করুন (এটা `/etc/classvault.env` ফাইলেও থাকে)।

## ৪. পরে আপডেট করতে
```bash
cd ~/classvault && git pull && bash deploy/install.sh class.yourdomain.com you@email.com
```
ভিডিও, ডাটাবেস আর পাসওয়ার্ড অপরিবর্তিত থাকে।

## দরকারি কমান্ড
- লগ দেখা: `journalctl -u classvault -f`
- রিস্টার্ট: `systemctl restart classvault`
- অ্যাডমিন পাসওয়ার্ড বদলানো: `/etc/classvault.env` ফাইলে `ADMIN_PASSWORD` বদলে `systemctl restart classvault`
- ব্যাকআপ: `/var/lib/classvault` ফোল্ডারটা কপি করে রাখুন (এখানে ডাটাবেস আর সব ভিডিও আছে)

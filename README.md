# Ruang Arus

PWA untuk pencatatan keuangan pribadi dan usaha. Aplikasi tetap bisa mencatat secara lokal saat offline; backend Supabase menyediakan akun, pencadangan cloud, sinkronisasi antarperangkat, dan webhook WhatsApp.

## Menjalankan di komputer

```powershell
node serve.mjs
```

Buka `http://localhost:4173`.

## Fitur

- Dashboard ringkasan pemasukan, pengeluaran, sisa cicilan, tabungan, dan laba usaha.
- Pemasukan/pengeluaran dengan kategori, cicilan beserta pembayaran, target dan setoran tabungan, serta budget bulanan.
- Rekap usaha harian berupa omset, HPP, biaya, dan laba bersih. Setiap rekap otomatis mencatat omset dikurangi HPP satu kali sebagai pemasukan pribadi berkategori Pendapatan usaha; biaya harian tetap dicatat terpisah.
- Ruang catatan yang bisa dibuka untuk membaca isi lengkap, detail transaksi dari riwayat pribadi, ekspor/impor JSON, dukungan offline, dan instalasi PWA.
- Pembacaan foto/screenshot struk melalui OCR bahasa Indonesia di browser. Foto diproses pada perangkat dan tidak dikirim ke Supabase atau penyedia AI; mesin OCR dan data bahasa diunduh dari jsDelivr saat pertama digunakan.
- Akun Supabase Auth dan sinkronisasi cloud. Pengguna harus mencentang persetujuan sebelum data keuangan lokal diunggah. Perubahan berikutnya dikirim otomatis setelah tersimpan; tombol sinkronisasi mengambil catatan dari perangkat lain.
- Webhook WhatsApp Business Cloud API menerima catatan teks dengan format sederhana, membuat draf, meminta `SIMPAN`/`BATAL`, dan mengirim kuitansi ringkas setelah dicatat.

## Sinkronisasi dan privasi

Di **Pengaturan & data**, buat akun atau masuk pada kedua ponsel dengan email yang sama. Pada perangkat pertama, centang persetujuan sinkronisasi lalu aktifkan. Perangkat lain masuk dan tekan **Sinkronkan sekarang**. Sinkronisasi menggabungkan daftar catatan yang memiliki ID unik dan mengirim snapshot aplikasi ke proyek Supabase Ruang Arus di Singapura. RLS membatasi baris ke akun pemiliknya. Simpan cadangan JSON berkala sebagai perlindungan tambahan.

## WhatsApp Business

Webhook sudah tersedia di Supabase pada `/functions/v1/whatsapp-webhook`, tetapi belum bisa menerima pesan sungguhan sampai Meta Cloud API dan secret dikonfigurasi. Tambahkan secrets di Supabase Edge Functions: `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`; Supabase menyediakan `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` untuk fungsi.

Di Meta Developers, tambahkan callback URL di atas, gunakan verify token yang sama, lalu subscribe ke `messages`. Pastikan secret aplikasi Meta dan token akses disimpan hanya di Supabase, jangan di GitHub atau PWA. Buat kode tautan dari aplikasi, lalu kirim `hubungkan KODE` ke nomor bot. Format transaksi: `jajan sepuluh ribu beli es`, balas `SIMPAN` untuk mengonfirmasi, atau `BATAL` untuk membuang draf. Foto WhatsApp belum diekstrak otomatis; unggah foto dari menu **＋ → Baca dari foto** agar OCR tetap lokal.

## Memasang di ponsel

Buka situs HTTPS di Android Chrome lalu pilih **Install app/Tambahkan ke layar utama**. Di iPhone, buka di Safari, tekan **Bagikan → Tambahkan ke Layar Utama**. Masuk di kedua ponsel untuk menggunakan sinkronisasi.


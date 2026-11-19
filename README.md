# Ruang Arus

Aplikasi pencatatan keuangan pribadi dan usaha dengan penyimpanan lokal, dukungan offline, serta ekspor/impor cadangan.

## Menjalankan di komputer

PWA perlu dibuka melalui `localhost` atau situs HTTPS. Pastikan Node.js tersedia, lalu dari folder proyek ini jalankan:

```powershell
node serve.mjs
```

Lalu buka `http://localhost:4173`.

## Memasang di ponsel

Publikasikan folder ini pada hosting HTTPS. Di Android, buka alamat situs melalui Chrome lalu pilih **Install app** atau **Tambahkan ke layar utama**. Di iPhone, buka di Safari, tekan **Bagikan**, lalu **Tambahkan ke Layar Utama**. Setelah halaman berhasil dibuka sekali, shell aplikasi dapat digunakan offline.

## Ruang dan fitur

- Ringkasan pemasukan, pengeluaran, sisa cicilan, dan laba usaha.
- Keuangan pribadi: transaksi pemasukan dan pengeluaran dengan kategori yang dapat diubah.
- Cicilan: total kewajiban, nominal yang telah dibayar, sisa, dan pencatatan pembayaran sebagai pengeluaran.
- Tabungan: beberapa target dengan nominal tujuan, progres setoran, dan total yang sudah disisihkan.
- Budget pengeluaran bulanan, dengan sisa jatah yang terlihat di dashboard.
- Saran pencatatan pribadi untuk menjaga catatan harian konsisten.
- Keuangan usaha: omset, HPP, biaya lain, dan laba bersih per tanggal.
- Ruang catatan untuk prompt, ide, tulisan, atau data.
- Cadangan JSON untuk mengunduh data atau mengimpornya pada perangkat lain.

## Batas penyimpanan saat ini

Data disimpan di `localStorage` browser dan tidak dikirim ke server. PWA dapat dipasang di dua ponsel, tetapi perubahan tidak tersinkron otomatis antarponsel. Untuk berbagi data langsung perlu layanan backend dengan akun dan konfigurasi sinkronisasi.


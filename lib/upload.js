// lib/upload.js
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { fileTypeFromStream } = require("file-type");
const { PassThrough } = require("stream");

// 🔐 Cloudflare R2 credentials
const R2_ENDPOINT = "https://79e032ce11db553736bf04e6acde8d21.r2.cloudflarestorage.com";
const BUCKET = "senaldb";
const ACCESS_KEY = "c7c891d949318478f60201ee24ea49c9";
const SECRET_KEY = "bb8c10e792b77c734aaa9984684ee7aa41349f1640b40da4688876ef092b9350";

// 🌐 S3 client
const s3 = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
  },
});

// 📤 Upload stream to R2
async function uploadToR2(inputStream, filename = "file") {
  try {
    const pass1 = new PassThrough();
    const pass2 = new PassThrough();
    inputStream.pipe(pass1);
    inputStream.pipe(pass2);

    const fileType = await fileTypeFromStream(pass1);
    const ext = fileType ? `.${fileType.ext}` : "";
    const contentType = fileType?.mime || "application/octet-stream";
    const key = `${filename}${ext}`;

    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: pass2,
      ContentType: contentType,
      ACL: "public-read",
    });

    await s3.send(command);

    const publicUrl = `${R2_ENDPOINT}/${BUCKET}/${key}`;
    console.log("✅ Uploaded to R2:", publicUrl);
    return publicUrl;
  } catch (err) {
    console.error("❌ R2 Upload failed:", err.message);
    return null;
  }
}

module.exports = { uploadToR2 };

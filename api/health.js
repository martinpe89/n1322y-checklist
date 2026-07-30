export default function handler(req, res) {
  const health = {
    status: 'ok',
    environment: {
      databaseUrl: !!process.env.DATABASE_URL,
      blobToken: !!process.env.BLOB_READ_WRITE_TOKEN,
      accessCode: !!process.env.ACCESS_CODE,
      sessionSecret: !!process.env.SESSION_SECRET,
    },
  };

  res.status(200).json(health);
}

const { createApp } = require('./src/app');

const PORT = process.env.PORT || 3000;
createApp().listen(PORT, () => {
  console.log(`IIT Veterinaria corriendo en http://localhost:${PORT}`);
});

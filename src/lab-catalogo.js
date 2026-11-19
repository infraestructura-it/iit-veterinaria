// Catálogo inicial de exámenes de laboratorio clínico veterinario.
// Categorías tomadas de la oferta típica de un laboratorio veterinario (p. ej. A3 Laboratorio, Bogotá).
// IMPORTANTE: los intervalos de referencia son orientativos (literatura general para caninos y felinos adultos).
// Cada laboratorio debe validarlos con su equipo y metodología y ajustarlos en Laboratorio → Catálogo.

const CATEGORIAS = [
  'Hematología', 'Pruebas de coagulación', 'Química sanguínea', 'Minerales', 'Hormonas', 'Uroanálisis',
  'Dermatología', 'Citología', 'Parasitología', 'Microbiología', 'Histopatología', 'Pruebas específicas',
];

// p: [nombre, unidad, [min, max] canino, [min, max] felino]   ·   t: [nombre, valor normal] (parámetro de texto)
const p = (nombre, unidad, can, fel) => ({ nombre, unidad, can, fel });
const t = (nombre, normal = '') => ({ nombre, tipo: 'texto', normal });

const EXAMENES = [
  {
    codigo: 'HEM-01', nombre: 'Cuadro hemático completo', categoria: 'Hematología', muestra: 'Sangre total con EDTA (tubo lila), 1 ml',
    indicaciones: 'Mantener refrigerada (2-8 °C). Procesar antes de 24 h. No congelar.', precio: 45000, tiempo_entrega: 24,
    parametros: [
      p('Hematocrito', '%', [37, 55], [30, 45]),
      p('Hemoglobina', 'g/dL', [12, 18], [8, 15]),
      p('Eritrocitos', 'x10⁶/µL', [5.5, 8.5], [5, 10]),
      p('VCM', 'fL', [60, 77], [39, 55]),
      p('HCM', 'pg', [19.5, 24.5], [12.5, 17.5]),
      p('CHCM', 'g/dL', [32, 36], [30, 36]),
      p('Leucocitos', 'x10³/µL', [6, 17], [5.5, 19.5]),
      p('Neutrófilos segmentados', 'x10³/µL', [3, 11.5], [2.5, 12.5]),
      p('Neutrófilos en banda', 'x10³/µL', [0, 0.3], [0, 0.3]),
      p('Linfocitos', 'x10³/µL', [1, 4.8], [1.5, 7]),
      p('Monocitos', 'x10³/µL', [0.15, 1.35], [0, 0.85]),
      p('Eosinófilos', 'x10³/µL', [0.1, 1.25], [0, 0.75]),
      p('Plaquetas', 'x10³/µL', [200, 500], [300, 800]),
      p('Proteínas plasmáticas totales', 'g/dL', [6, 8], [6, 8]),
      t('Hemoparásitos', 'No se observan'),
      t('Morfología celular', 'Normal'),
    ],
  },
  {
    codigo: 'COA-01', nombre: 'Tiempos de coagulación (PT / PTT)', categoria: 'Pruebas de coagulación', muestra: 'Sangre con citrato de sodio 3,2 % (tubo azul), llenado completo',
    indicaciones: 'Respetar la proporción sangre/anticoagulante 9:1. Centrifugar y separar plasma antes de 4 h.', precio: 60000, tiempo_entrega: 24,
    parametros: [p('Tiempo de protrombina (PT)', 's', [6, 12], [7, 13]), p('Tiempo parcial de tromboplastina (PTT)', 's', [9, 20], [10, 22])],
  },
  {
    codigo: 'QS-01', nombre: 'Perfil hepático', categoria: 'Química sanguínea', muestra: 'Suero (tubo rojo o amarillo), 1 ml',
    indicaciones: 'Ayuno de 8 a 12 horas. Evitar hemólisis y lipemia. Separar suero antes de 2 h.', precio: 70000, tiempo_entrega: 24,
    parametros: [
      p('ALT (GPT)', 'U/L', [10, 100], [10, 100]),
      p('AST (GOT)', 'U/L', [0, 50], [0, 48]),
      p('Fosfatasa alcalina', 'U/L', [20, 150], [10, 90]),
      p('Bilirrubina total', 'mg/dL', [0, 0.9], [0, 0.9]),
      p('Proteínas totales', 'g/dL', [5.2, 8.2], [5.7, 8.9]),
      p('Albúmina', 'g/dL', [2.3, 4], [2.2, 4]),
    ],
  },
  {
    codigo: 'QS-02', nombre: 'Perfil renal', categoria: 'Química sanguínea', muestra: 'Suero (tubo rojo o amarillo), 1 ml',
    indicaciones: 'Ayuno de 8 horas. Evitar hemólisis.', precio: 50000, tiempo_entrega: 24,
    parametros: [p('Creatinina', 'mg/dL', [0.5, 1.8], [0.8, 2.4]), p('BUN (nitrógeno ureico)', 'mg/dL', [7, 27], [16, 36])],
  },
  {
    codigo: 'QS-03', nombre: 'Glucosa', categoria: 'Química sanguínea', muestra: 'Suero o plasma con fluoruro (tubo gris)',
    indicaciones: 'Ayuno de 8 horas. Procesar pronto: la glucosa disminuye en sangre sin separar.', precio: 15000, tiempo_entrega: 12,
    parametros: [p('Glucosa', 'mg/dL', [70, 143], [74, 159])],
  },
  {
    codigo: 'MIN-01', nombre: 'Calcio y fósforo', categoria: 'Minerales', muestra: 'Suero (tubo rojo), 1 ml',
    indicaciones: 'Ayuno de 8 horas. Evitar hemólisis.', precio: 35000, tiempo_entrega: 24,
    parametros: [p('Calcio total', 'mg/dL', [7.9, 12], [7.8, 11.3]), p('Fósforo', 'mg/dL', [2.5, 6.8], [3.1, 7.5])],
  },
  {
    codigo: 'HOR-01', nombre: 'T4 total', categoria: 'Hormonas', muestra: 'Suero (tubo rojo), 1 ml',
    indicaciones: 'Registrar medicación tiroidea y hora de la última dosis.', precio: 75000, tiempo_entrega: 48,
    parametros: [p('T4 total', 'µg/dL', [1, 4], [0.8, 4.7])],
  },
  {
    codigo: 'URO-01', nombre: 'Uroanálisis completo', categoria: 'Uroanálisis', muestra: 'Orina (cistocentesis preferible), 5-10 ml en frasco estéril',
    indicaciones: 'Refrigerar y procesar antes de 6 h. Indicar método de toma.', precio: 30000, tiempo_entrega: 24,
    parametros: [
      t('Método de toma', ''), t('Color', 'Amarillo'), t('Aspecto', 'Transparente'),
      p('Densidad urinaria', '', [1.015, 1.045], [1.035, 1.06]), p('pH', '', [5.5, 7.5], [6, 7.5]),
      t('Proteínas', 'Negativo'), t('Glucosa', 'Negativo'), t('Cetonas', 'Negativo'), t('Sangre', 'Negativo'),
      t('Sedimento', 'Sin hallazgos significativos'),
    ],
  },
  {
    codigo: 'DER-01', nombre: 'Raspado cutáneo y tricograma', categoria: 'Dermatología', muestra: 'Raspado profundo y pelos de zona periférica a la lesión',
    indicaciones: 'No aplicar tratamientos tópicos 48 h antes. Enviar en lámina o recipiente seco.', precio: 35000, tiempo_entrega: 24,
    parametros: [t('Ácaros (Demodex / Sarcoptes)', 'No se observan'), t('Dermatofitos en tricograma', 'No se observan'), t('Observaciones', '')],
  },
  {
    codigo: 'CIT-01', nombre: 'Citología de oído', categoria: 'Citología', muestra: 'Hisopado ótico de ambos conductos, rotulado derecho/izquierdo',
    indicaciones: 'No limpiar el oído antes de tomar la muestra.', precio: 30000, tiempo_entrega: 24,
    parametros: [t('Levaduras (Malassezia)', 'Escasas o ausentes'), t('Cocos', 'Escasos o ausentes'), t('Bacilos', 'Ausentes'), t('Células inflamatorias', 'Ausentes'), t('Ácaros (Otodectes)', 'No se observan')],
  },
  {
    codigo: 'PAR-01', nombre: 'Coprológico', categoria: 'Parasitología', muestra: 'Materia fecal fresca, 5 g en recipiente limpio',
    indicaciones: 'Refrigerar y enviar antes de 12 h. Idealmente seriado de 3 muestras.', precio: 20000, tiempo_entrega: 24,
    parametros: [t('Consistencia', 'Formada'), t('Moco', 'Negativo'), t('Sangre', 'Negativo'), t('Huevos de helmintos', 'No se observan'), t('Quistes / protozoarios', 'No se observan')],
  },
  {
    codigo: 'MIC-01', nombre: 'Cultivo y antibiograma', categoria: 'Microbiología', muestra: 'Hisopo estéril en medio de transporte',
    indicaciones: 'Tomar antes de iniciar antibióticos. Mantener refrigerado.', precio: 95000, tiempo_entrega: 72,
    parametros: [t('Microorganismo aislado', 'Sin crecimiento'), t('Sensible a', ''), t('Resistente a', '')],
  },
  {
    codigo: 'HIS-01', nombre: 'Histopatología (biopsia)', categoria: 'Histopatología', muestra: 'Tejido en formol bufferado al 10 % (10 volúmenes por 1 de tejido)',
    indicaciones: 'Indicar localización, tamaño y tiempo de evolución de la lesión.', precio: 160000, tiempo_entrega: 120,
    parametros: [t('Descripción macroscópica', ''), t('Descripción microscópica', ''), t('Diagnóstico morfológico', ''), t('Márgenes', '')],
  },
  {
    codigo: 'ESP-01', nombre: 'Test rápido Ehrlichia / Anaplasma / Dirofilaria', categoria: 'Pruebas específicas', muestra: 'Sangre total con EDTA o suero',
    indicaciones: 'Muestra a temperatura ambiente antes de procesar.', precio: 85000, tiempo_entrega: 4,
    parametros: [t('Ehrlichia canis', 'Negativo'), t('Anaplasma spp.', 'Negativo'), t('Dirofilaria immitis (antígeno)', 'Negativo')],
  },
];

module.exports = { CATEGORIAS, EXAMENES };

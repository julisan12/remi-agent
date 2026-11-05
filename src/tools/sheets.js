// src/tools/sheets.js — Google Sheets via Service Account
import { google } from 'googleapis';

const SHEET_ID          = process.env.GOOGLE_SHEET_ID;
const SHEET_STUDENTS_ID = process.env.GOOGLE_STUDENTS_SHEET_ID;
const SHEET_NAME        = 'Empleos';
const SHEET_STUDENTS    = 'Estudiantes';

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

// Agregar filas de empleos al sheet
export async function appendJobs(jobs) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const rows = jobs.map((job) => [
    new Date().toLocaleDateString('es-CO'),
    job.title,
    job.company,
    job.platform,
    job.applyUrl,
    '100% Remoto',
    job.sector,
    job.publishedAt,
    'Nuevo',
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:I`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });

  console.log(`✅ ${rows.length} empleos guardados en Sheets`);
}

// ─── BASE DE DATOS ESTUDIANTES ────────────────────────────────────────────

const STUDENT_HEADERS = [
  'ID Estudiante', 'Nombre Completo', 'Email', 'Teléfono', 'País',
  'Generación', 'Programa', 'Método de Pago', 'Fecha de Inscripción',
  'Acceso Academia', 'Acceso Sistema', 'Acceso Tu AcademiaWork',
  'Estado Examen Interno', 'Fecha del Examen',
  'Calificación Práctica', 'Calificación Teórica',
  'Estado Certiprof', 'Código Certiprof', 'Fecha Certificación',
  'VIP', 'Notas Importantes',
];

export async function ensureStudentHeaders() {
  const auth   = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // Verificar si la pestaña "Estudiantes" existe, si no crearla
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_STUDENTS_ID });
  const tabExists = meta.data.sheets.some(s => s.properties.title === SHEET_STUDENTS);

  if (!tabExists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_STUDENTS_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: SHEET_STUDENTS } } }],
      },
    });
    console.log(`✅ Pestaña "${SHEET_STUDENTS}" creada en Sheets`);
  }

  // Verificar headers
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_STUDENTS_ID,
    range: `${SHEET_STUDENTS}!A1:U1`,
  });

  if (!res.data.values || res.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_STUDENTS_ID,
      range: `${SHEET_STUDENTS}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [STUDENT_HEADERS] },
    });
    console.log('✅ Headers de Estudiantes creados en Sheets');
  }
}

export async function appendStudent(student) {
  const auth   = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const hoy = new Date().toLocaleDateString('es-CO');

  const row = [
    student.id               || '',
    student.nombre           || '',
    student.email            || '',
    student.telefono         || '',
    student.pais             || '',
    student.generacion       || 'Gen 16',
    student.programa         || 'Certificación Internacional',
    student.metodoPago       || '',
    student.fechaInscripcion || hoy,
    'NO',        // Acceso Academia
    'NO',        // Acceso Sistema
    'NO',        // Acceso Tu AcademiaWork
    'Pendiente', // Estado Examen Interno
    '',          // Fecha del Examen
    '',          // Calificación Práctica
    '',          // Calificación Teórica
    'Pendiente', // Estado Certiprof
    '',          // Código Certiprof
    '',          // Fecha Certificación
    'NO',        // VIP
    '',          // Notas Importantes
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_STUDENTS_ID,
    range: `${SHEET_STUDENTS}!A:U`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });

  console.log(`✅ Estudiante guardado en Sheets: ${student.nombre}`);
}

// ─── EMPLEOS ──────────────────────────────────────────────────────────────

// Verificar/crear headers si el sheet está vacío
export async function ensureHeaders() {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A1:I1`,
  });

  if (!res.data.values || res.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A1:I1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [['Fecha', 'Cargo', 'Empresa', 'Plataforma', 'Enlace', 'Modalidad', 'Sector', 'Publicado', 'Estado']],
      },
    });
  }
}

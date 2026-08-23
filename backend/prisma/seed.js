const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

// 18 doctors across 15 specialisations, so patients searching by specialisation
// get a realistic, comparable set of profiles to choose between (some
// specialisations intentionally have 2 doctors with different schedules/bios).
const DOCTORS = [
  {
    email: 'manasvikhare9@gmail.com', name: 'Aisha Mehta', specialisation: 'General Physician',
    bio: 'MBBS, MD — 12 years of experience in general and family medicine. Focuses on everyday illnesses, checkups, and preventive care.',
    slotDurationMinutes: 20, workStartMinutes: 540, workEndMinutes: 1020, workingDays: 'MON,TUE,WED,THU,FRI',
  },
  {
    email: 'dr.singh@clinic.local', name: 'Manpreet Singh', specialisation: 'General Physician',
    bio: 'MBBS, DNB Family Medicine — 8 years in primary care with a focus on chronic disease management and lifestyle-related conditions.',
    slotDurationMinutes: 20, workStartMinutes: 600, workEndMinutes: 1080, workingDays: 'MON,TUE,WED,THU,FRI,SAT',
  },
  {
    email: 'dr.rao@clinic.local', name: 'Karthik Rao', specialisation: 'Dermatology',
    bio: 'MBBS, DDVL — skin, hair, and nail specialist with an interest in acne, eczema, and cosmetic dermatology.',
    slotDurationMinutes: 30, workStartMinutes: 600, workEndMinutes: 960, workingDays: 'MON,WED,FRI',
  },
  {
    email: 'dr.fernandes@clinic.local', name: 'Clara Fernandes', specialisation: 'Dermatology',
    bio: 'MD Dermatology — 10 years treating psoriasis, pigmentation disorders, and pediatric skin conditions.',
    slotDurationMinutes: 25, workStartMinutes: 540, workEndMinutes: 900, workingDays: 'TUE,THU,SAT',
  },
  {
    email: 'dr.iyer@clinic.local', name: 'Priya Iyer', specialisation: 'Cardiology',
    bio: 'MBBS, DM Cardiology — 15 years treating hypertension, arrhythmia, and coronary artery disease.',
    slotDurationMinutes: 30, workStartMinutes: 540, workEndMinutes: 900, workingDays: 'MON,TUE,THU',
  },
  {
    email: 'dr.bhat@clinic.local', name: 'Suresh Bhat', specialisation: 'Cardiology',
    bio: 'MD, DM Cardiology — interventional cardiologist focused on preventive heart care and post-cardiac-event recovery.',
    slotDurationMinutes: 30, workStartMinutes: 660, workEndMinutes: 1020, workingDays: 'WED,THU,FRI',
  },
  {
    email: 'dr.khan@clinic.local', name: 'Sana Khan', specialisation: 'Pediatrics',
    bio: 'MBBS, MD Pediatrics — newborn to teen care, vaccinations, and growth monitoring.',
    slotDurationMinutes: 20, workStartMinutes: 570, workEndMinutes: 990, workingDays: 'MON,TUE,WED,THU,FRI,SAT',
  },
  {
    email: 'dr.verma@clinic.local', name: 'Rohan Verma', specialisation: 'Orthopedics',
    bio: 'MBBS, MS Ortho — joint pain, sports injuries, fractures, and post-surgical rehab.',
    slotDurationMinutes: 30, workStartMinutes: 600, workEndMinutes: 1020, workingDays: 'TUE,WED,THU,FRI',
  },
  {
    email: 'dr.nair@clinic.local', name: 'Lakshmi Nair', specialisation: 'Gynecology',
    bio: "MBBS, MS OBG — women's health, prenatal care, and reproductive health across all life stages.",
    slotDurationMinutes: 25, workStartMinutes: 540, workEndMinutes: 900, workingDays: 'MON,WED,FRI,SAT',
  },
  {
    email: 'dr.das@clinic.local', name: 'Arjun Das', specialisation: 'Psychiatry',
    bio: 'MBBS, MD Psychiatry — anxiety, depression, sleep disorders, and stress management, in a judgment-free space.',
    slotDurationMinutes: 40, workStartMinutes: 660, workEndMinutes: 1080, workingDays: 'MON,TUE,WED,THU,FRI',
  },
  {
    email: 'dr.menon@clinic.local', name: 'Divya Menon', specialisation: 'ENT',
    bio: 'MBBS, MS ENT — ear, nose, throat, sinus issues, hearing concerns, and allergies.',
    slotDurationMinutes: 20, workStartMinutes: 570, workEndMinutes: 930, workingDays: 'MON,TUE,THU,FRI',
  },
  {
    email: 'dr.kapoor@clinic.local', name: 'Neha Kapoor', specialisation: 'Neurology',
    bio: 'MBBS, DM Neurology — migraines, epilepsy, nerve disorders, and post-stroke care.',
    slotDurationMinutes: 35, workStartMinutes: 600, workEndMinutes: 960, workingDays: 'MON,WED,FRI',
  },
  {
    email: 'dr.gupta@clinic.local', name: 'Vikram Gupta', specialisation: 'Gastroenterology',
    bio: 'MBBS, DM Gastroenterology — acid reflux, IBS, liver conditions, and digestive health.',
    slotDurationMinutes: 30, workStartMinutes: 540, workEndMinutes: 900, workingDays: 'TUE,WED,THU',
  },
  {
    email: 'dr.reddy@clinic.local', name: 'Anjali Reddy', specialisation: 'Endocrinology',
    bio: 'MBBS, DM Endocrinology — diabetes, thyroid disorders, and hormonal health.',
    slotDurationMinutes: 30, workStartMinutes: 570, workEndMinutes: 930, workingDays: 'MON,TUE,THU,FRI',
  },
  {
    email: 'dr.joshi@clinic.local', name: 'Rahul Joshi', specialisation: 'Ophthalmology',
    bio: 'MBBS, MS Ophthalmology — routine eye exams, cataracts, glaucoma, and vision correction.',
    slotDurationMinutes: 20, workStartMinutes: 600, workEndMinutes: 960, workingDays: 'MON,WED,FRI,SAT',
  },
  {
    email: 'dr.pillai@clinic.local', name: 'Meera Pillai', specialisation: 'Urology',
    bio: "MBBS, MCh Urology — kidney stones, urinary tract concerns, and men's and women's urological health.",
    slotDurationMinutes: 30, workStartMinutes: 660, workEndMinutes: 1020, workingDays: 'TUE,THU,SAT',
  },
  {
    email: 'dr.chowdhury@clinic.local', name: 'Sourav Chowdhury', specialisation: 'Pulmonology',
    bio: 'MBBS, MD Pulmonology — asthma, chronic cough, sleep apnea, and respiratory infections.',
    slotDurationMinutes: 25, workStartMinutes: 540, workEndMinutes: 900, workingDays: 'MON,TUE,WED,FRI',
  },
  {
    email: 'dr.thomas@clinic.local', name: 'Elizabeth Thomas', specialisation: 'Dentistry',
    bio: 'BDS, MDS — general dentistry, root canals, cleanings, and oral health checkups.',
    slotDurationMinutes: 20, workStartMinutes: 570, workEndMinutes: 990, workingDays: 'MON,TUE,WED,THU,FRI,SAT',
  },
];

async function main() {
  const passwordHash = await bcrypt.hash('password123', 10);

  await prisma.user.upsert({
    where: { email: 'admin@clinic.local' },
    update: {},
    create: { name: 'Clinic Admin', email: 'admin@clinic.local', passwordHash, role: 'ADMIN' },
  });

  for (const d of DOCTORS) {
    const doctorUser = await prisma.user.upsert({
      where: { email: d.email },
      update: { name: d.name },
      create: { name: d.name, email: d.email, passwordHash, role: 'DOCTOR' },
    });
    await prisma.doctorProfile.upsert({
      where: { userId: doctorUser.id },
      update: {
        specialisation: d.specialisation,
        bio: d.bio,
        slotDurationMinutes: d.slotDurationMinutes,
        workStartMinutes: d.workStartMinutes,
        workEndMinutes: d.workEndMinutes,
        workingDays: d.workingDays,
      },
      create: {
        userId: doctorUser.id,
        specialisation: d.specialisation,
        bio: d.bio,
        slotDurationMinutes: d.slotDurationMinutes,
        workStartMinutes: d.workStartMinutes,
        workEndMinutes: d.workEndMinutes,
        workingDays: d.workingDays,
      },
    });
  }

  await prisma.user.upsert({
    where: { email: 'manasvikhare19@gmail.com' },
    update: { name: 'Riya Sharma' },
    create: { name: 'Riya Sharma', email: 'manasvikhare19@gmail.com', phone: '9876543210', passwordHash, role: 'PATIENT' },
  });

  await prisma.user.upsert({
    where: { email: 'patient@example.com' },
    update: { name: 'Riya Sharma' },
    create: { name: 'Riya Sharma', email: 'patient@example.com', phone: '9876543210', passwordHash, role: 'PATIENT' },
  });

  console.log('Seeded:');
  console.log('  Admin    -> admin@clinic.local / password123');
  DOCTORS.forEach((d, i) => {
    console.log(`  Doctor ${i + 1} -> ${d.email} / password123 (${d.specialisation})`);
  });
  console.log('  Patient (Real) -> manasvikhare19@gmail.com / password123');
  console.log('  Patient (Demo) -> patient@example.com / password123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
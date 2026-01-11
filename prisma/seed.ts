import { PrismaClient, UserRole, InvoiceStatus, PaymentStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // Create Companies
  const sellerCompany = await prisma.company.upsert({
    where: { registrationNo: 'COMP-001' },
    update: {},
    create: {
      name: 'Tech Solutions Inc.',
      registrationNo: 'COMP-001',
      taxId: 'TAX-12345',
      address: '123 Innovation Drive',
      city: 'San Francisco',
      state: 'CA',
      country: 'USA',
      postalCode: '94105',
      phone: '+1-555-123-4567',
      email: 'contact@techsolutions.com',
      website: 'https://techsolutions.com',
    },
  });

  const buyerCompany = await prisma.company.upsert({
    where: { registrationNo: 'COMP-002' },
    update: {},
    create: {
      name: 'Global Retail Corp.',
      registrationNo: 'COMP-002',
      taxId: 'TAX-67890',
      address: '456 Commerce Blvd',
      city: 'New York',
      state: 'NY',
      country: 'USA',
      postalCode: '10001',
      phone: '+1-555-987-6543',
      email: 'procurement@globalretail.com',
      website: 'https://globalretail.com',
    },
  });

  console.log('✅ Companies created');

  // Create Users
  const hashedPassword = await bcrypt.hash('password123', 12);

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@eibs.com' },
    update: {},
    create: {
      email: 'admin@eibs.com',
      password: hashedPassword,
      firstName: 'System',
      lastName: 'Admin',
      role: UserRole.ADMIN,
      emailVerified: true,
      companyId: sellerCompany.id,
    },
  });

  const accountantUser = await prisma.user.upsert({
    where: { email: 'accountant@techsolutions.com' },
    update: {},
    create: {
      email: 'accountant@techsolutions.com',
      password: hashedPassword,
      firstName: 'John',
      lastName: 'Smith',
      role: UserRole.ACCOUNTANT,
      emailVerified: true,
      companyId: sellerCompany.id,
    },
  });

  const buyerUser = await prisma.user.upsert({
    where: { email: 'buyer@globalretail.com' },
    update: {},
    create: {
      email: 'buyer@globalretail.com',
      password: hashedPassword,
      firstName: 'Jane',
      lastName: 'Doe',
      role: UserRole.USER,
      emailVerified: true,
      companyId: buyerCompany.id,
    },
  });

  console.log('✅ Users created');

  // Create Sample Invoices
  const invoice1 = await prisma.invoice.upsert({
    where: { invoiceNumber: 'INV-2024-0001' },
    update: {},
    create: {
      invoiceNumber: 'INV-2024-0001',
      sellerId: sellerCompany.id,
      buyerId: buyerCompany.id,
      createdById: accountantUser.id,
      issueDate: new Date('2024-01-15'),
      dueDate: new Date('2024-02-15'),
      subtotal: 10000.00,
      taxAmount: 800.00,
      discountAmount: 500.00,
      totalAmount: 10300.00,
      currency: 'USD',
      status: InvoiceStatus.APPROVED,
      paymentStatus: PaymentStatus.PAID,
      notes: 'Q1 Software License Renewal',
      terms: 'Net 30',
      items: {
        create: [
          {
            description: 'Enterprise Software License - Annual',
            quantity: 1,
            unitPrice: 8000.00,
            taxRate: 8,
            amount: 8640.00,
            productCode: 'SW-ENT-001',
          },
          {
            description: 'Premium Support Package',
            quantity: 1,
            unitPrice: 2000.00,
            taxRate: 8,
            amount: 2160.00,
            productCode: 'SUP-PREM-001',
          },
        ],
      },
    },
  });

  const invoice2 = await prisma.invoice.upsert({
    where: { invoiceNumber: 'INV-2024-0002' },
    update: {},
    create: {
      invoiceNumber: 'INV-2024-0002',
      sellerId: sellerCompany.id,
      buyerId: buyerCompany.id,
      createdById: accountantUser.id,
      issueDate: new Date('2024-02-01'),
      dueDate: new Date('2024-03-01'),
      subtotal: 5500.00,
      taxAmount: 440.00,
      discountAmount: 0,
      totalAmount: 5940.00,
      currency: 'USD',
      status: InvoiceStatus.PENDING,
      paymentStatus: PaymentStatus.UNPAID,
      notes: 'Consulting Services - February 2024',
      terms: 'Net 30',
      items: {
        create: [
          {
            description: 'Technical Consulting - 40 hours',
            quantity: 40,
            unitPrice: 125.00,
            taxRate: 8,
            amount: 5400.00,
            productCode: 'CONS-TECH-001',
            unit: 'hours',
          },
          {
            description: 'Documentation Package',
            quantity: 1,
            unitPrice: 500.00,
            taxRate: 8,
            amount: 540.00,
            productCode: 'DOC-STD-001',
          },
        ],
      },
    },
  });

  console.log('✅ Sample invoices created');

  // Create Audit Logs
  await prisma.auditLog.createMany({
    data: [
      {
        userId: adminUser.id,
        action: 'CREATE',
        entityType: 'Company',
        entityId: sellerCompany.id,
        newValue: { name: sellerCompany.name },
      },
      {
        userId: accountantUser.id,
        invoiceId: invoice1.id,
        action: 'CREATE',
        entityType: 'Invoice',
        entityId: invoice1.id,
        newValue: { invoiceNumber: invoice1.invoiceNumber },
      },
      {
        userId: accountantUser.id,
        invoiceId: invoice1.id,
        action: 'APPROVE',
        entityType: 'Invoice',
        entityId: invoice1.id,
        oldValue: { status: 'PENDING' },
        newValue: { status: 'APPROVED' },
      },
    ],
  });

  console.log('✅ Audit logs created');
  console.log('🎉 Database seeding completed!');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

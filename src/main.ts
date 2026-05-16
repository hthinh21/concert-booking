import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Global prefix api - EX: api/v1/users
  app.setGlobalPrefix('api/v1');

  // Validation - EX: khi gửi request nếu data không đúng format thì sẽ báo lỗi ngay
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Exception filter - EX: khi có lỗi thì sẽ trả về lỗi cho client dạng JSON 
  app.useGlobalFilters(new HttpExceptionFilter());

  // Response interceptor - EX: khi response sẽ trả về thêm success, timestamp, data
  app.useGlobalInterceptors(new ResponseInterceptor());

  // Swagger - EX: http://localhost:3000/api/docs
  const config = new DocumentBuilder()
    .setTitle('GEEKUP Concert Booking API')
    .setDescription('Concert Ticket Booking Platform - Backend API')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('Auth')
    .addTag('Concerts')
    .addTag('Bookings')
    .addTag('Vouchers')
    .addTag('Admin')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(process.env.PORT || 3000);
  console.log(`Server running on http://localhost:${process.env.PORT || 3000}`);
  console.log(`Swagger docs at http://localhost:${process.env.PORT || 3000}/api/docs`);
}

bootstrap();
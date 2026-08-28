import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MikroORM } from '@mikro-orm/postgresql';
import { AppModule } from './app.module';
import { JsonLogger } from './shared/infrastructure/json-logger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    // Logger estruturado (seção 12) desde o boot — inclusive os logs
    // internos do próprio Nest passam a sair em JSON.
    logger: new JsonLogger(),
  });

  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // derruba campo que não está no DTO
      forbidNonWhitelisted: true, // e rejeita a requisição em vez de ignorar silenciosamente
      transform: true, // converte payload plano pra instância de classe (Type() dos DTOs aninhados depende disso)
    }),
  );

  // MikroORM.init() (rodado pelo MikroOrmModule) não conecta mais
  // automaticamente — só descobre entidades e cria o EntityManager. Sem
  // isso, checkConnection() do health indicator nunca sai de "Connection
  // not established" mesmo com o Postgres de pé. Não derruba o boot se
  // falhar: /health/ready reporta down até o banco ficar acessível.
  const orm = app.get(MikroORM);
  try {
    await orm.connect();
    Logger.log('Database connection established', 'Bootstrap');
  } catch (error) {
    Logger.error(
      `Could not establish database connection at startup — /health/ready will report down until it succeeds: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
      undefined,
      'Bootstrap',
    );
  }

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);

  Logger.log(`Application listening on port ${port}`, 'Bootstrap');
}

void bootstrap();

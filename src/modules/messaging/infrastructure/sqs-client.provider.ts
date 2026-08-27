import type { Provider } from '@nestjs/common';
import { SQSClient } from '@aws-sdk/client-sqs';

/**
 * `AWS_ENDPOINT` aponta pro LocalStack em dev (`docker-compose.yml`);
 * fica vazio em produção pra usar o endpoint real da AWS.
 */
export const sqsClientProvider: Provider = {
  provide: SQSClient,
  useFactory: () =>
    new SQSClient({
      region: process.env.AWS_REGION ?? 'us-east-1',
      endpoint: process.env.AWS_ENDPOINT || undefined,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
      },
    }),
};

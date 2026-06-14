import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private logger = new Logger(PrismaService.name);

  onModuleInit() {
    this.$connect()
      .then(() => this.logger.log('Database connected'))
      .catch((ex) =>
        this.logger.error(
          'Database failed connecting: ',
          (ex as Error).message,
        ),
      );
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

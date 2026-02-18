import { Module, Global } from '@nestjs/common';
import { ConnectionService } from './connection.service';

@Global() // чтобы не импортировать везде
@Module({
  providers: [ConnectionService],
  exports: [ConnectionService],
})
export class CoreModule {}

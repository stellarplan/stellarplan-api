import { Global, Module } from '@nestjs/common';
import { ChallengeService } from './challenge.service';

@Global()
@Module({
  providers: [ChallengeService],
  exports: [ChallengeService],
})
export class CommonModule {}

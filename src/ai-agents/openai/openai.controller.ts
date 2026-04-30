import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OpenAiService } from './openai.service';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { User } from '@prisma/client';

@ApiTags('OpenAI Agent')
@Controller('ai-agents/openai')
export class OpenAiAgentController {
  constructor(private readonly openAiService: OpenAiService) {}

  @UseGuards(CookieAuthGuard)
  @Post()
  openNewChat(
    @CurrentUser() user: User,
    @Body() { message }: { message: string },
  ) {
    return this.openAiService.openNewChat(user.id, message);
  }
}

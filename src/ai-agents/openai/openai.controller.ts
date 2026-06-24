import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OpenAiService } from './openai.service';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { User } from '@prisma/client';
import { OpenAiChatDto } from './dto/openai-chat.dto';

@ApiTags('OpenAI Agent')
@UseGuards(CookieAuthGuard)
@Controller('ai-agents/openai')
export class OpenAiAgentController {
  constructor(private readonly openAiService: OpenAiService) {}

  @ApiOperation({ description: 'Start a new OpenAI chat or continue conversation.' })
  @Post()
  openNewChat(
    @CurrentUser() user: User,
    @Body() body: OpenAiChatDto,
  ) {
    return this.openAiService.openNewChat(user.id, body.message);
  }
}

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  Chat,
  Message,
  MessageTypeEnum,
  NursePermissionEnum,
  Prisma,
  User,
  UserRolesEnum,
} from '@prisma/client';
import { CreateChatDto } from './dto/create-chat.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { NurseService } from '../nurse/nurse.service';

@Injectable()
export class ChatService {
  private onlineUsers: Map<string, Set<string>> = new Map();

  constructor(
    private readonly prisma: PrismaService,
    private readonly nurseService: NurseService,
  ) {}

  // ─────────────────────────── Chat Management ───────────────────────────

  /**
   * Create a new chat between two users, or return the open one they already
   * share. Only starting a chat is restricted (see validateChatRules); either
   * party may reopen an existing chat, so a nurse can answer a doctor who
   * contacted them first. Admin/SuperAdmin initiators may chat with anyone.
   */
  async createChat(
    initiatorId: string,
    dto: CreateChatDto,
  ): Promise<any> {
    const { participantId, topic, consultationId } = dto;

    if (initiatorId === participantId) {
      throw new BadRequestException('Cannot create a chat with yourself');
    }

    // Fetch both users
    const [initiator, participant] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: initiatorId } }),
      this.prisma.user.findUnique({ where: { id: participantId } }),
    ]);

    if (!initiator) {
      throw new NotFoundException('Initiator not found');
    }
    if (!participant) {
      throw new NotFoundException('Participant not found');
    }
    if (!initiator.isActive) {
      throw new ForbiddenException('Your account is deactivated');
    }
    if (initiator.isBanned) {
      throw new ForbiddenException('Your account is banned');
    }
    if (!participant.isActive) {
      throw new BadRequestException('Participant account is deactivated');
    }
    if (participant.isBanned) {
      throw new BadRequestException('Participant account is banned');
    }

    // Check if chat already exists between these two users
    const existingChat = await this.findExistingChat(
      initiatorId,
      participantId,
    );
    if (existingChat) {
      const { parties, ...rest } = existingChat;
      return {
        ...rest,
        participants: parties.map((p) => ({
          ...p.user,
          joinedAt: p.joinedAt,
          lastSeenAt: p.lastSeenAt,
        })),
      };
    }

    // Enforce chat rules (admins bypass)
    if (!initiator.isAdmin && !initiator.isSuperAdmin) {
      await this.validateChatRules(initiator, participant);
    }

    // A chat can be linked only to the consultation between its own two participants.
    if (consultationId) {
      const consultation = await this.prisma.consultation.findUnique({
        where: { id: consultationId },
        include: { doctor: true },
      });
      if (!consultation) {
        throw new NotFoundException('Consultation not found');
      }
      const involved = [consultation.patientId, consultation.doctor?.userId];
      if (!involved.includes(initiatorId) || !involved.includes(participantId)) {
        throw new ForbiddenException(
          'A chat can only be linked to a consultation between its two participants',
        );
      }
    }

    // Create chat + participants in a transaction
    let chat;
    try {
      chat = await this.prisma.chat.create({
        data: {
          topic: topic || null,
          consultationId: consultationId || null,
          parties: {
            create: [
              { userId: initiatorId },
              { userId: participantId },
            ],
          },
        },
        include: {
          parties: { include: { user: { select: this.userSelect() } } },
        },
      });
    } catch (err) {
      // Chat.consultationId is unique: e.g. the consultation's earlier chat was closed.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('This consultation already has a chat');
      }
      throw err;
    }

    const { parties, ...rest } = chat;
    return {
      ...rest,
      participants: parties.map((p) => ({
        ...p.user,
        joinedAt: p.joinedAt,
        lastSeenAt: p.lastSeenAt,
      })),
    };
  }

  async getUserChats(
    userId: string,
    skip = 0,
    take = 20,
  ): Promise<{
    chats: any[];
    total: number;
  }> {
    const where = {
      parties: { some: { userId } },
    };

    const [chats, total] = await Promise.all([
      this.prisma.chat.findMany({
        where,
        skip: Number(skip) || 0,
        take: Math.min(Number(take) || 20, 50),
        orderBy: { updatedAt: 'desc' },
        include: {
          parties: {
            include: { user: { select: this.userSelect() } },
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            where: { deletedAt: null },
            include: {
              sender: { select: this.userSelect() },
            },
          },
        },
      }),
      this.prisma.chat.count({ where }),
    ]);

    // Compute unread count for each chat
    const enrichedChats = chats.map((chat) => {
      const lastMessage = chat.messages[0] || null;
      const otherParties = chat.parties.filter((p) => p.userId !== userId);
      const myParticipant = chat.parties.find((p) => p.userId === userId);
      const unreadCount = this.computeUnreadIndicator(
        lastMessage,
        myParticipant,
        userId,
      );

      return {
        id: chat.id,
        topic: chat.topic,
        consultationId: chat.consultationId,
        closedAt: chat.closedAt,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
        participants: otherParties.map((p) => ({
          ...p.user,
          joinedAt: p.joinedAt,
          lastSeenAt: p.lastSeenAt,
          isOnline: this.isOnline(p.userId),
        })),
        lastMessage: lastMessage
          ? this.serializeMessage(lastMessage)
          : null,
        unreadCount,
      };
    });

    return { chats: enrichedChats, total };
  }

  async getChatById(chatId: string, userId: string): Promise<any> {
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      include: {
        parties: {
          include: { user: { select: this.userSelect() } },
        },
      },
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    this.assertParticipant(chat, userId);

    const { parties, ...rest } = chat;
    return {
      ...rest,
      participants: parties.map((p) => ({
        ...p.user,
        joinedAt: p.joinedAt,
        lastSeenAt: p.lastSeenAt,
        isOnline: this.isOnline(p.userId),
      })),
    };
  }

  async getUserChatIds(userId: string): Promise<string[]> {
    const participants = await this.prisma.chatParticipant.findMany({
      where: { userId },
      select: { chatId: true },
    });
    return participants.map((p) => p.chatId);
  }

  async assertChatParticipant(chatId: string, userId: string): Promise<void> {
    const participant = await this.prisma.chatParticipant.findUnique({
      where: {
        chatId_userId: {
          chatId,
          userId,
        },
      },
      select: { chatId: true },
    });

    if (!participant) {
      throw new ForbiddenException('You are not a participant in this chat');
    }
  }

  // ─────────────────────────── Message Management ───────────────────────────

  async sendMessage(
    chatId: string,
    senderId: string,
    dto: SendMessageDto,
  ): Promise<Message> {
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      include: { parties: true },
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    if (chat.closedAt) {
      throw new BadRequestException('This chat has been closed');
    }

    this.assertParticipant(chat, senderId);

    const sender = await this.prisma.user.findUnique({
      where: { id: senderId },
      select: { isActive: true, isBanned: true },
    });
    if (!sender || !sender.isActive) {
      throw new ForbiddenException('Your account is deactivated');
    }
    if (sender.isBanned) {
      throw new ForbiddenException('Your account is banned');
    }

    const messageData: any = {
      chatId,
      senderId,
      content: dto.content,
      type: dto.type || MessageTypeEnum.TEXT,
      fileUrl: dto.fileUrl || null,
    };

    if (dto.repliedToId) {
      const repliedTo = await this.prisma.message.findUnique({
        where: { id: BigInt(dto.repliedToId) },
        select: { id: true, chatId: true },
      });
      if (!repliedTo) {
        throw new NotFoundException('Message to reply to not found');
      }
      if (repliedTo.chatId !== chatId) {
        throw new BadRequestException(
          'Cannot reply to a message from a different chat',
        );
      }
      messageData.repliedToId = repliedTo.id;
    }

    const message = await this.prisma.message.create({
      data: messageData,
      include: {
        sender: { select: this.userSelect() },
        repliedTo: dto.repliedToId
          ? {
              select: {
                id: true,
                content: true,
                senderId: true,
                type: true,
              },
            }
          : false,
      },
    });

    // Update chat's updatedAt to keep ordering fresh
    await this.prisma.chat.update({
      where: { id: chatId },
      data: { updatedAt: new Date() },
    });

    return message;
  }

  async getMessages(
    chatId: string,
    userId: string,
    skip = 0,
    take = 50,
  ): Promise<{ messages: any[]; total: number }> {
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      include: { parties: true },
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    this.assertParticipant(chat, userId);

    const where: { chatId: string; deletedAt: null } = {
      chatId,
      deletedAt: null,
    };

    const [messages, total] = await Promise.all([
      this.prisma.message.findMany({
        where,
        skip: Number(skip) || 0,
        take: Math.min(Number(take) || 50, 100),
        orderBy: { createdAt: 'desc' },
        include: {
          sender: { select: this.userSelect() },
          repliedTo: {
            select: {
              id: true,
              content: true,
              senderId: true,
              type: true,
            },
          },
        },
      }),
      this.prisma.message.count({ where }),
    ]);

    return {
      messages: messages.map((m) => this.serializeMessage(m)),
      total,
    };
  }

  async markAsRead(
    chatId: string,
    userId: string,
    messageId: bigint,
  ): Promise<void> {
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      include: { parties: true },
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    this.assertParticipant(chat, userId);

    await this.prisma.$transaction(async (tx) => {
      const messages = await tx.message.findMany({
        where: {
          chatId,
          id: { lte: messageId },
          senderId: { not: userId },
          deletedAt: null,
        },
        select: { id: true, readBy: true },
        orderBy: { id: 'desc' },
        take: 500,
      });

      const now = new Date().toISOString();

      const updates = messages
        .filter((msg) => {
          const readBy = (msg.readBy as any[]) || [];
          return !readBy.some((r) => r.userId === userId);
        })
        .map((msg) => {
          const readBy = [
            ...((msg.readBy as any[]) || []),
            { userId, readAt: now },
          ];
          return tx.message.update({
            where: { id: msg.id },
            data: { readBy },
          });
        });

      if (updates.length > 0) {
        await Promise.all(updates);
      }

      await tx.chatParticipant.update({
        where: { chatId_userId: { chatId, userId } },
        data: { lastSeenAt: new Date() },
      });
    });
  }

  async editMessage(
    messageId: bigint,
    userId: string,
    newContent: string,
  ): Promise<Message> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message || message.deletedAt) {
      throw new NotFoundException('Message not found');
    }

    if (message.senderId !== userId) {
      throw new ForbiddenException('You can only edit your own messages');
    }

    if (message.type !== MessageTypeEnum.TEXT) {
      throw new BadRequestException('Only text messages can be edited');
    }

    return this.prisma.message.update({
      where: { id: messageId },
      data: {
        content: newContent,
        editedAt: new Date(),
      },
      include: {
        sender: { select: this.userSelect() },
        repliedTo: {
          select: {
            id: true,
            content: true,
            senderId: true,
            type: true,
          },
        },
      },
    });
  }

  async deleteMessage(
    messageId: bigint,
    userId: string,
  ): Promise<Message> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message || message.deletedAt) {
      throw new NotFoundException('Message not found');
    }

    if (message.senderId !== userId) {
      throw new ForbiddenException('You can only delete your own messages');
    }

    return this.prisma.message.update({
      where: { id: messageId },
      data: {
        deletedAt: new Date(),
        content: '[Message deleted]',
      },
      include: {
        sender: { select: this.userSelect() },
        repliedTo: {
          select: {
            id: true,
            content: true,
            senderId: true,
            type: true,
          },
        },
      },
    });
  }

  // ─────────────────────────── Presence Tracking ───────────────────────────

  setOnline(userId: string, socketId: string): void {
    if (!this.onlineUsers.has(userId)) {
      this.onlineUsers.set(userId, new Set());
    }
    this.onlineUsers.get(userId)!.add(socketId);
  }

  setOffline(userId: string, socketId: string): void {
    const sockets = this.onlineUsers.get(userId);
    if (sockets) {
      sockets.delete(socketId);
      if (sockets.size === 0) {
        this.onlineUsers.delete(userId);
      }
    }
  }

  isOnline(userId: string): boolean {
    return this.onlineUsers.has(userId) && this.onlineUsers.get(userId)!.size > 0;
  }

  getSocketIds(userId: string): string[] {
    const sockets = this.onlineUsers.get(userId);
    return sockets ? Array.from(sockets) : [];
  }

  // ─────────────────────────── Private Helpers ───────────────────────────

  /** Who may start a new chat; admin initiators are exempt (see createChat). */
  private async validateChatRules(initiator: User, participant: User): Promise<void> {
    const { PATIENT, DOCTOR, NURSE } = UserRolesEnum;
    const from = initiator.role;
    const to = participant.role;

    if (from === PATIENT && to === PATIENT) {
      throw new BadRequestException(
        'Patients cannot start chats with other patients',
      );
    }

    if (from === PATIENT && to === DOCTOR) return;

    if (from === PATIENT && to === NURSE) {
      const doctorIds = await this.nurseService.getDoctorIdsForNurse(
        participant.id,
        NursePermissionEnum.CHAT_WITH_PATIENTS,
      );
      if (doctorIds.length === 0) {
        throw new ForbiddenException(
          'This nurse is not available for patient chats',
        );
      }
      await this.assertPatientBelongsToDoctor(initiator.id, doctorIds);
      return;
    }

    if (from === PATIENT) {
      throw new BadRequestException(
        'Patients can only chat with doctors or nurses',
      );
    }

    if (from === DOCTOR && to === PATIENT) {
      const profile = await this.prisma.doctorProfile.findUnique({
        where: { userId: initiator.id },
        select: { id: true },
      });
      if (
        !profile ||
        !(await this.patientBelongsToDoctor(participant.id, [profile.id]))
      ) {
        throw new ForbiddenException(
          'You can only start chats with your own patients',
        );
      }
      return;
    }

    // Lets a verified doctor approach any nurse (e.g. to hire one); a nurse may
    // only start chats with doctors they are assigned to.
    if (from === DOCTOR && to === NURSE) {
      const profile = await this.prisma.doctorProfile.findUnique({
        where: { userId: initiator.id },
        select: { verified: true },
      });
      if (!profile?.verified) {
        throw new ForbiddenException(
          'Only verified doctors can start chats with nurses',
        );
      }
      return;
    }

    if (from === NURSE && to === PATIENT) {
      const doctorIds = await this.nurseService.getDoctorIdsForNurse(
        initiator.id,
        NursePermissionEnum.CHAT_WITH_PATIENTS,
      );
      if (doctorIds.length === 0) {
        throw new ForbiddenException(
          'You do not have the Chat with Patients permission',
        );
      }
      await this.assertPatientBelongsToDoctor(participant.id, doctorIds);
      return;
    }

    if (from === NURSE && to === DOCTOR) {
      const assignment = await this.prisma.doctorNurseAssignment.findFirst({
        where: {
          nurseId: initiator.id,
          isActive: true,
          doctor: { userId: participant.id },
        },
        select: { id: true },
      });
      if (!assignment) {
        throw new ForbiddenException(
          'You can only start chats with doctors you are assigned to',
        );
      }
      return;
    }

    // Doctor↔doctor waits for the friend system (Phase 17); nurse↔nurse and
    // users without a role (NONE, which includes admin accounts) are out too.
    throw new ForbiddenException('You cannot start a chat with this user');
  }

  private async assertPatientBelongsToDoctor(
    patientUserId: string,
    doctorIds: number[],
  ): Promise<void> {
    if (!(await this.patientBelongsToDoctor(patientUserId, doctorIds))) {
      throw new ForbiddenException(
        'This patient does not belong to your assigned doctor(s)',
      );
    }
  }

  /** Accepting a match creates its consultation, so matches need no lookup of their own. */
  private async patientBelongsToDoctor(
    patientUserId: string,
    doctorIds: number[],
  ): Promise<boolean> {
    const relation = await this.prisma.consultation.findFirst({
      where: {
        patientId: patientUserId,
        doctorId: { in: doctorIds },
      },
      select: { id: true },
    });
    if (relation) return true;

    const appointment = await this.prisma.appointment.findFirst({
      where: {
        patientId: patientUserId,
        doctorId: { in: doctorIds },
      },
      select: { id: true },
    });
    return !!appointment;
  }

  private async findExistingChat(
    userId1: string,
    userId2: string,
  ) {
    return this.prisma.chat.findFirst({
      where: {
        closedAt: null,
        AND: [
          { parties: { some: { userId: userId1 } } },
          { parties: { some: { userId: userId2 } } },
        ],
      },
      include: {
        parties: { include: { user: { select: this.userSelect() } } },
      },
    });
  }

  private assertParticipant(
    chat: Chat & { parties: Array<{ userId: string }> },
    userId: string,
  ): void {
    const isParticipant = chat.parties.some((p) => p.userId === userId);
    if (!isParticipant) {
      throw new ForbiddenException('You are not a participant in this chat');
    }
  }

  private computeUnreadIndicator(
    lastMessage: any,
    myParticipant: any,
    userId: string,
  ): number {
    if (!lastMessage) return 0;
    if (lastMessage.senderId === userId) return 0;
    if (
      myParticipant?.lastSeenAt &&
      new Date(myParticipant.lastSeenAt) >= new Date(lastMessage.createdAt)
    ) {
      return 0;
    }
    // In a production system, you'd count unread messages properly.
    // For MVP, just indicate presence of unread messages.
    return 1;
  }

  serializeMessage(message: any): any {
    return {
      ...message,
      id: message.id?.toString(),
      repliedToId: message.repliedToId?.toString() || null,
      repliedTo: message.repliedTo
        ? {
            ...message.repliedTo,
            id: message.repliedTo.id?.toString(),
          }
        : null,
    };
  }

  async getChatParticipantUserIds(chatId: string): Promise<string[]> {
    const participants = await this.prisma.chatParticipant.findMany({
      where: { chatId },
      select: { userId: true },
    });
    return participants.map((p) => p.userId);
  }

  private userSelect() {
    return {
      id: true,
      firstname: true,
      lastname: true,
      avatar: true,
      role: true,
      isAdmin: true,
      isSuperAdmin: true,
    };
  }
}

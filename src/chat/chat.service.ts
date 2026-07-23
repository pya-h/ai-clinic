import {
  BadRequestException,
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
   * Create a new chat between two users, enforcing business rules:
   * - No patient↔patient chats
   * - Admin/SuperAdmin can chat with anyone
   * - Patient can only chat with doctor/nurse
   * - If chat already exists between these users, return the existing one
   */
  async createChat(
    initiatorId: string,
    dto: CreateChatDto,
  ): Promise<Chat> {
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
    if (!participant.isActive) {
      throw new BadRequestException('Participant account is deactivated');
    }

    // Enforce chat rules (admins bypass)
    if (!initiator.isAdmin && !initiator.isSuperAdmin) {
      await this.validateChatRules(initiator, participant);
    }

    // Check if chat already exists between these two users
    const existingChat = await this.findExistingChat(
      initiatorId,
      participantId,
    );
    if (existingChat) {
      return existingChat;
    }

    // If consultationId is given, verify it exists and either party is involved
    if (consultationId) {
      const consultation = await this.prisma.consultation.findUnique({
        where: { id: consultationId },
        include: { doctor: true },
      });
      if (!consultation) {
        throw new NotFoundException('Consultation not found');
      }
      // Verify either the patient or doctor is one of the participants
      const doctorUserId = consultation.doctor?.userId;
      const involved = [consultation.patientId, doctorUserId].filter(Boolean);
      if (
        !involved.includes(initiatorId) &&
        !involved.includes(participantId)
      ) {
        throw new ForbiddenException(
          'Neither participant is involved in this consultation',
        );
      }
    }

    // Create chat + participants in a transaction
    const chat = await this.prisma.chat.create({
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

    return chat;
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

    return {
      ...chat,
      participants: chat.parties.map((p) => ({
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

  async getUserStatus(userId: string): Promise<{ isActive: boolean; isBanned: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true, isBanned: true },
    });
    if (!user) return { isActive: false, isBanned: false };
    return { isActive: user.isActive, isBanned: user.isBanned };
  }

  // ─────────────────────────── Private Helpers ───────────────────────────

  private async validateChatRules(initiator: User, participant: User): Promise<void> {
    // No patient ↔ patient chats
    if (
      initiator.role === UserRolesEnum.PATIENT &&
      participant.role === UserRolesEnum.PATIENT
    ) {
      throw new BadRequestException(
        'Patients cannot start chats with other patients',
      );
    }

    // Patients can only chat with DOCTOR or NURSE
    if (initiator.role === UserRolesEnum.PATIENT) {
      if (
        participant.role !== UserRolesEnum.DOCTOR &&
        participant.role !== UserRolesEnum.NURSE
      ) {
        throw new BadRequestException(
          'Patients can only chat with doctors or nurses',
        );
      }
    }

    // Nurses need CHAT_WITH_PATIENTS permission to chat with patients
    if (
      initiator.role === UserRolesEnum.NURSE &&
      participant.role === UserRolesEnum.PATIENT
    ) {
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
    }

    // Patient initiating chat with a nurse — verify the nurse has CHAT_WITH_PATIENTS
    if (
      initiator.role === UserRolesEnum.PATIENT &&
      participant.role === UserRolesEnum.NURSE
    ) {
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
    }
  }

  private async assertPatientBelongsToDoctor(
    patientUserId: string,
    doctorIds: number[],
  ): Promise<void> {
    const relation = await this.prisma.consultation.findFirst({
      where: {
        patientId: patientUserId,
        doctorId: { in: doctorIds },
      },
      select: { id: true },
    });
    if (!relation) {
      const appointment = await this.prisma.appointment.findFirst({
        where: {
          patientId: patientUserId,
          doctorId: { in: doctorIds },
        },
        select: { id: true },
      });
      if (!appointment) {
        throw new ForbiddenException(
          'This patient does not belong to your assigned doctor(s)',
        );
      }
    }
  }

  private async findExistingChat(
    userId1: string,
    userId2: string,
  ): Promise<Chat | null> {
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

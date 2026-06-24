import { Logger } from '@nestjs/common';
import { TestingLogger } from '@nestjs/testing/services/testing-logger.service';

Logger.overrideLogger(false);
TestingLogger.prototype.error = function () {};
TestingLogger.prototype.warn = function () {};

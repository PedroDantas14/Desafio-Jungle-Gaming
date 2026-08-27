import { Injectable } from '@nestjs/common';
import { IdGenerator } from '../application/id-generator';
import { uuidv7 } from './uuidv7';

@Injectable()
export class Uuidv7IdGenerator implements IdGenerator {
  next(): string {
    return uuidv7();
  }
}

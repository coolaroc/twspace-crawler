import fs from 'fs'
import readline from 'readline'
import winston from 'winston'
import { MessageKind } from '../enums/Periscope.enum'
import { ChatHistoryMessage, ChatMessage, ChatMessageData } from '../interfaces/Periscope.interface'
import { logger as baseLogger } from '../logger'
import { Util } from '../utils/Util'
import { AISummarizer } from './AISummarizer'

export class SpaceCaptionsExtractor {
  private logger: winston.Logger
  private aiSummarizer: AISummarizer
  private enableAISummary: boolean

  constructor(
    private inpFile: string,
    private outFile?: string,
    private startedAt?: number,
  ) {
    this.logger = baseLogger.child({ label: '[SpaceCaptionsExtractor]' })

    this.inpFile = inpFile
    this.outFile = outFile === inpFile
      ? `${outFile}.txt`
      : (outFile || `${inpFile}.txt`)
    
    // 从环境变量或配置中读取AI总结设置
    this.enableAISummary = process.env.AI_ENABLED === 'true' || false;
    
    if (this.enableAISummary) {
      const aiApiKey = process.env.AI_API_KEY;
      const aiApiEndpoint = process.env.AI_API_ENDPOINT || 'https://api.x.ai/v1/chat/completions';
      const aiModel = process.env.AI_MODEL || 'grok-2';
      
      if (aiApiKey) {
        this.aiSummarizer = new AISummarizer(aiApiKey, aiApiEndpoint, aiModel);
      } else {
        this.logger.warn('AI总结功能已启用但未提供API密钥');
      }
    }
  }

  public async extract(outputDir?: string): Promise<string> {
    // eslint-disable-next-line no-async-promise-executor
    return new Promise<string>(async (resolve, reject) => {
      try {
        if (!fs.existsSync(this.inpFile)) {
          this.logger.warn(`Input file not found at ${this.inpFile}`)
          return
        }
        fs.writeFileSync(this.outFile, '')
        await this.processFile()

        // 当提取完成后，进行AI总结
        if (this.enableAISummary && this.aiSummarizer && outputDir) {
          try {
            await this.aiSummarizer.summarizeCaptions(this.outFile, outputDir);
            this.logger.info(`已完成AI总结流程`);
          } catch (error) {
            this.logger.error(`AI总结过程中出错: ${error.message}`);
          }
        }

        resolve(this.outFile)
      } catch (error) {
        this.logger.error(error.message)
        reject(error)
      }
    })
  }

  private async processFile() {
    // eslint-disable-next-line no-async-promise-executor
    return new Promise<void>(async (resolve) => {
      this.logger.info(`Loading captions from ${this.inpFile}`)
      const fileStream = fs.createReadStream(this.inpFile)
      const rl = readline.createInterface({ input: fileStream })
      let lineCount = 0
      rl.on('line', (line) => {
        lineCount += 1
        try {
          this.processLine(line)
        } catch (error) {
          this.logger.error(`Failed to process line ${lineCount}: ${error.message}`)
        }
      })
      rl.once('close', () => {
        this.logger.info(`Captions saved to ${this.outFile}`)
        resolve()
      })
    })
  }

  private processLine(payload: string) {
    const obj = JSON.parse(payload) as ChatHistoryMessage
    if (obj.kind !== MessageKind.CHAT) {
      return
    }
    this.processChat(obj.payload)
  }

  private processChat(payload: string) {
    const obj = JSON.parse(payload) as ChatMessage
    if (!obj.uuid) {
      return
    }
    this.processChatData(obj.body)
  }

  private processChatData(payload: string) {
    const obj = JSON.parse(payload) as ChatMessageData
    if (!obj.final || !obj.body) {
      return
    }
    const time = this.startedAt
      ? `${Util.getDisplayTime(Math.max(0, obj.timestamp - this.startedAt))} | `
      : ''
    const msg = `${time}${obj.username}: ${obj.body.trim()}\n`
    fs.appendFileSync(this.outFile, msg)
  }
}

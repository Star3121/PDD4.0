import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import sharp from 'sharp';

// 初始化 Supabase 客户端
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const isVercel = process.env.VERCEL || process.env.VERCEL_ENV;

// R2/S3 配置
const s3Endpoint = process.env.R2_ENDPOINT || process.env.S3_ENDPOINT;
const s3AccessKeyId = process.env.R2_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID;
const s3SecretAccessKey = process.env.R2_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY;
const s3BucketName = process.env.R2_BUCKET_NAME || process.env.S3_BUCKET_NAME;
const s3PublicDomain = process.env.R2_PUBLIC_DOMAIN || process.env.S3_PUBLIC_DOMAIN;

// 存储提供商：'local', 'supabase', 's3'
let storageProvider = 'local';

if (s3Endpoint && s3AccessKeyId && s3SecretAccessKey && s3BucketName) {
  storageProvider = 's3';
} else if (supabaseUrl && supabaseKey) {
  storageProvider = 'supabase';
}

// 强制覆盖（如果环境变量指定）
if (process.env.STORAGE_PROVIDER) {
  storageProvider = process.env.STORAGE_PROVIDER;
}

let supabase;
let s3Client;

if (storageProvider === 'supabase') {
  supabase = createClient(supabaseUrl, supabaseKey);
} else if (storageProvider === 's3') {
  s3Client = new S3Client({
    region: 'auto',
    endpoint: s3Endpoint,
    credentials: {
      accessKeyId: s3AccessKeyId,
      secretAccessKey: s3SecretAccessKey,
    },
  });
}

/**
 * 存储服务类
 * 统一处理文件存储和访问，屏蔽底层实现差异（本地文件系统 vs 对象存储）
 */
class StorageService {
  constructor() {
    this.provider = storageProvider;
    console.log(`[StorageService] Using provider: ${this.provider}`);
  }

  /**
   * 获取文件的访问方式（重定向 URL 或 本地文件路径）
   * @param {string} bucket - 存储桶名称 (如 'images', 'templates', 'designs')
   * @param {string} filename - 文件名
   * @returns {Promise<{type: 'redirect'|'file', url?: string, path?: string, contentType?: string}>}
   */
  async getFileAccess(bucket, filename) {
    // S3 / R2
    if (this.provider === 's3') {
      try {
        // 如果配置了公共域名，直接返回 CDN URL (对于 R2 + Cloudflare CDN)
        if (s3PublicDomain) {
           // 处理 URL 拼接，避免双重斜杠
           const baseUrl = s3PublicDomain.endsWith('/') ? s3PublicDomain.slice(0, -1) : s3PublicDomain;
           // R2 通常不需要 bucket 前缀，除非是路径风格。假设是自定义域名映射到 Bucket
           // 格式: https://cdn.example.com/folder/file.jpg
           const url = `${baseUrl}/${bucket}/${filename}`;
           return { type: 'redirect', url };
        }

        // 否则生成预签名 URL
        const command = new GetObjectCommand({
          Bucket: s3BucketName,
          Key: `${bucket}/${filename}`,
        });
        const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        return { type: 'redirect', url };
      } catch (error) {
        console.error(`[StorageService] S3 error for ${bucket}/${filename}:`, error);
        return null;
      }
    }

    // Supabase
    if (this.provider === 'supabase') {
      try {
        if (bucket === 'templates') {
          const { data } = supabase.storage.from(bucket).getPublicUrl(filename);
          return { type: 'redirect', url: data.publicUrl };
        } else {
          const { data, error } = await supabase.storage
            .from(bucket)
            .createSignedUrl(filename, 60 * 60);

          if (error) throw error;
          if (!data?.signedUrl) throw new Error('Failed to generate signed URL');

          return { type: 'redirect', url: data.signedUrl };
        }
      } catch (error) {
        console.error(`[StorageService] Supabase error for ${bucket}/${filename}:`, error);
        return null;
      }
    } 
    
    // Local
    {
      const baseDir = isVercel ? `/tmp/${bucket}` : path.join(process.cwd(), `uploads/${bucket}`);
      const filePath = path.join(baseDir, filename);

      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        throw new Error('Invalid filename');
      }

      if (fs.existsSync(filePath)) {
        return { type: 'file', path: filePath };
      }
      
      const fallbackPath = path.join(process.cwd(), `uploads/${bucket}`, filename);
      if (fs.existsSync(fallbackPath)) {
        return { type: 'file', path: fallbackPath };
      }

      return null;
    }
  }

  /**
   * 下载文件到本地
   */
  async downloadFile(bucket, filename, destPath) {
    if (this.provider === 's3') {
      const command = new GetObjectCommand({
        Bucket: s3BucketName,
        Key: `${bucket}/${filename}`,
      });
      const response = await s3Client.send(command);
      const buffer = await response.Body.transformToByteArray();
      fs.writeFileSync(destPath, Buffer.from(buffer));
    } else if (this.provider === 'supabase') {
      const { data, error } = await supabase.storage
        .from(bucket)
        .download(filename);
      if (error) throw error;
      const buffer = await data.arrayBuffer();
      fs.writeFileSync(destPath, Buffer.from(buffer));
    } else {
      const baseDir = isVercel ? `/tmp/${bucket}` : path.join(process.cwd(), `uploads/${bucket}`);
      const srcPath = path.join(baseDir, filename);
      const fallbackPath = path.join(process.cwd(), `uploads/${bucket}`, filename);
      
      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath);
      } else if (fs.existsSync(fallbackPath)) {
        fs.copyFileSync(fallbackPath, destPath);
      } else {
        throw new Error(`File not found: ${filename}`);
      }
    }
  }

  /**
   * 内部上传辅助函数
   */
  async _uploadSingle(bucket, filename, fileData, contentType) {
    let body = fileData;
    if (typeof fileData === 'string') {
      body = fs.readFileSync(fileData);
    }

    if (this.provider === 's3') {
      const command = new PutObjectCommand({
        Bucket: s3BucketName,
        Key: `${bucket}/${filename}`,
        Body: body,
        ContentType: contentType,
      });
      await s3Client.send(command);
      return `${bucket}/${filename}`;
    } else if (this.provider === 'supabase') {
      const { data, error } = await supabase.storage
        .from(bucket)
        .upload(filename, body, {
          contentType: contentType,
          upsert: true
        });
      if (error) throw error;
      return data.path;
    } else {
      const baseDir = isVercel ? `/tmp/${bucket}` : path.join(process.cwd(), `uploads/${bucket}`);
      if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true });
      }
      const destPath = path.join(baseDir, filename);
      if (Buffer.isBuffer(fileData)) {
        fs.writeFileSync(destPath, fileData);
      } else if (typeof fileData === 'string' && fileData !== destPath) {
        fs.copyFileSync(fileData, destPath);
      }
      return destPath;
    }
  }

  /**
   * 处理并上传图片（包括生成缩略图）
   * @param {string} bucket 
   * @param {string} filename 
   * @param {string} localFilePath 
   * @param {string} mimeType 
   */
  async uploadProcessedImage(bucket, filename, localFilePath, mimeType) {
    const tasks = [];

    // 1. 上传原图任务
    tasks.push(this._uploadSingle(bucket, filename, localFilePath, mimeType));
    if (bucket === 'designs') {
      await Promise.all(tasks);
      return;
    }

    // 仅对图片生成缩略图
    if (mimeType.startsWith('image/')) {
      try {
        // 读取文件 Buffer 用于生成缩略图
        const imageBuffer = fs.readFileSync(localFilePath);
        
        // 2. 生成并上传 Medium (1024px) 任务
        const mediumTask = (async () => {
          try {
            const mediumBuffer = await sharp(imageBuffer)
              .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
              .toBuffer();
            await this._uploadSingle(bucket, `medium_${filename}`, mediumBuffer, mimeType);
          } catch (error) {
            console.error(`[StorageService] Medium thumbnail failed for ${filename}:`, error);
            await this._uploadSingle(bucket, `medium_${filename}`, imageBuffer, mimeType);
          }
        })();
        tasks.push(mediumTask);

        // 3. 生成并上传 Thumb (512px) 任务
        const thumbTask = (async () => {
          try {
            const thumbBuffer = await sharp(imageBuffer)
              .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
              .toBuffer();
            await this._uploadSingle(bucket, `thumb_${filename}`, thumbBuffer, mimeType);
          } catch (error) {
            console.error(`[StorageService] Small thumbnail failed for ${filename}:`, error);
            await this._uploadSingle(bucket, `thumb_${filename}`, imageBuffer, mimeType);
          }
        })();
        tasks.push(thumbTask);
        
      } catch (error) {
        console.error(`[StorageService] Thumbnail generation preparation failed for ${filename}:`, error);
      }
    }

    // 并行执行所有上传任务
    await Promise.all(tasks);
    console.log(`[StorageService] Uploaded ${filename} and thumbnails (if any) in parallel`);
  }

  // 兼容旧接口，不再推荐直接使用
  async uploadFile(bucket, filename, fileData, contentType) {
    return this._uploadSingle(bucket, filename, fileData, contentType);
  }

  async deleteFile(bucket, filename) {
    const filesToDelete = bucket === 'designs'
      ? [filename]
      : [filename, `medium_${filename}`, `thumb_${filename}`];
    
    // 并行删除所有相关文件
    const deletePromises = filesToDelete.map(async (f) => {
      try {
        if (this.provider === 's3') {
          const command = new DeleteObjectCommand({
            Bucket: s3BucketName,
            Key: `${bucket}/${f}`,
          });
          await s3Client.send(command);
        } else if (this.provider === 'supabase') {
          await supabase.storage.from(bucket).remove([f]);
        } else {
          const baseDir = isVercel ? `/tmp/${bucket}` : path.join(process.cwd(), `uploads/${bucket}`);
          const filePath = path.join(baseDir, f);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          
          const fallbackPath = path.join(process.cwd(), `uploads/${bucket}`, f);
          if (filePath !== fallbackPath && fs.existsSync(fallbackPath)) fs.unlinkSync(fallbackPath);
        }
      } catch (e) {
        // 忽略删除不存在文件的错误
      }
    });

    await Promise.all(deletePromises);
  }
}

export default new StorageService();

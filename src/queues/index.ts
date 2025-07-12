/**
 * Queue system for background jobs
 */

// Simple mock queue for development
export const emailQueue = {
  add: (jobName: string, data: any) => {
    console.log(`📧 Email job queued: ${jobName}`, data);
    return Promise.resolve();
  }
};

export const notificationQueue = {
  add: (jobName: string, data: any) => {
    console.log(`🔔 Notification job queued: ${jobName}`, data);
    return Promise.resolve();
  }
};

export const fileProcessingQueue = {
  add: (jobName: string, data: any) => {
    console.log(`📁 File processing job queued: ${jobName}`, data);
    return Promise.resolve();
  }
};

export const analyticsQueue = {
  add: (jobName: string, data: any) => {
    console.log(`📊 Analytics job queued: ${jobName}`, data);
    return Promise.resolve();
  }
};

export function setupQueues() {
  console.log('📦 Queues initialized (mock mode)');
  return Promise.resolve();
}

export function closeQueues() {
  console.log('📦 Queues closed');
  return Promise.resolve();
}

export const addEmailJob = (type: string, data: any) => {
  return emailQueue.add(type, data);
};

export const addNotificationJob = (type: string, data: any) => {
  return notificationQueue.add(type, data);
};

export const addFileProcessingJob = (type: string, data: any) => {
  return fileProcessingQueue.add(type, data);
};

export default {
  emailQueue,
  notificationQueue,
  fileProcessingQueue,
  analyticsQueue
};
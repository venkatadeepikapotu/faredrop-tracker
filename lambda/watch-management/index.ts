import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, PutCommand, GetCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('🔥 Request:', event.httpMethod, event.path);

  // CORS headers for all responses
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'http://localhost:3000',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Amz-Date, X-Api-Key, X-Amz-Security-Token, X-Amz-User-Agent',
    'Access-Control-Allow-Credentials': 'true',
  };

  // Handle OPTIONS immediately, before auth
  if (event.httpMethod === 'OPTIONS') {
    console.log('✅ Handling OPTIONS preflight');
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  try {
    // Now check auth for non-OPTIONS requests
    const userId = getUserId(event);
    if (!userId) {
      console.log('❌ Unauthorized - no userId');
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Unauthorized', message: 'Invalid authentication token' }),
      };
    }

    console.log('✅ Authenticated user:', userId);

    const { httpMethod, pathParameters, path } = event;
    const watchId = pathParameters?.watchId;

    // ✅ ADDED - Handle /watches/{watchId}/history
    if (path.includes('/history')) {
      if (httpMethod === 'GET' && watchId) {
        return await getPriceHistory(watchId, headers);
      }
    }

    switch (httpMethod) {
      case 'GET':
        if (watchId) {
          return await getWatch(userId, watchId, headers);
        } else {
          return await listWatches(userId, headers);
        }
      case 'POST':
        return await createWatch(userId, event.body, headers);
      case 'PUT':  // ✅ ADDED - Handle PUT for full updates
        if (!watchId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Bad Request', message: 'watchId is required' }),
          };
        }
        return await updateWatch(userId, watchId, event.body, headers);
      case 'PATCH':
        if (!watchId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Bad Request', message: 'watchId is required' }),
          };
        }
        return await updateWatch(userId, watchId, event.body, headers);
      case 'DELETE':
        if (!watchId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Bad Request', message: 'watchId is required' }),
          };
        }
        return await deleteWatch(userId, watchId, headers);
      default:
        return {
          statusCode: 405,
          headers,
          body: JSON.stringify({ error: 'Method Not Allowed' }),
        };
    }
  } catch (error) {
    console.error('💥 Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal Server Error',
        message: (error as Error).message 
      }),
    };
  }
};

function getUserId(event: APIGatewayProxyEvent): string | null {
  console.log('🔍 Checking auth context...');
  
  const requestContext = event.requestContext as any;
  const authorizer = requestContext.authorizer;
  
  // Try multiple possible locations where Cognito puts the user ID
  const userId = authorizer?.claims?.sub ||
                 authorizer?.jwt?.claims?.sub ||
                 null;
  
  console.log('Extracted userId:', userId);
  
  if (!userId) {
    console.log('❌ No userId found');
    console.log('Authorizer:', JSON.stringify(authorizer, null, 2));
  }
  
  return userId;
}

async function listWatches(userId: string, headers: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    console.log('📋 Listing watches for user:', userId);
    
    const result = await docClient.send(new QueryCommand({
      TableName: process.env.WATCHES_TABLE!,
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': userId },
      ScanIndexForward: false,
    }));

    console.log('✅ Found', result.Items?.length || 0, 'watches');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ watches: result.Items || [] }),
    };
  } catch (error) {
    console.error('❌ Error listing watches:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to retrieve watches' }),
    };
  }
}

async function getWatch(userId: string, watchId: string, headers: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    console.log('🔍 Getting watch:', watchId, 'for user:', userId);
    
    const result = await docClient.send(new GetCommand({
      TableName: process.env.WATCHES_TABLE!,
      Key: { userId, watchId },
    }));

    if (!result.Item) {
      console.log('❌ Watch not found');
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Watch not found' }),
      };
    }

    console.log('✅ Watch found');
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result.Item),
    };
  } catch (error) {
    console.error('❌ Error getting watch:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to retrieve watch' }),
    };
  }
}

async function createWatch(userId: string, body: string | null, headers: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!body) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Request body is required' }),
      };
    }

    const request = JSON.parse(body);
    console.log('➕ Creating watch:', request);
    
    // Basic validation
    if (!request.origin || !request.destination || !request.departureDate || typeof request.priceThreshold !== 'number') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Missing required fields',
          required: ['origin', 'destination', 'departureDate', 'priceThreshold']
        }),
      };
    }

    const now = new Date().toISOString();
    const watch = {
      userId,
      watchId: randomUUID(),
      origin: request.origin.toUpperCase(),
      destination: request.destination.toUpperCase(),
      departureDate: request.departureDate,
      returnDate: request.returnDate || null,
      priceThreshold: request.priceThreshold,
      currency: request.currency || 'USD',
      isActive: 'true',
      createdAt: now,
      updatedAt: now,
    };

    await docClient.send(new PutCommand({
      TableName: process.env.WATCHES_TABLE!,
      Item: watch,
    }));

    console.log('✅ Watch created:', watch.watchId);

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify(watch),
    };
  } catch (error) {
    console.error('❌ Error creating watch:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to create watch',
        message: (error as Error).message
      }),
    };
  }
}

// ✅ UPDATED - Enhanced update function
async function updateWatch(userId: string, watchId: string, body: string | null, headers: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!body) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Request body is required' }),
      };
    }

    const request = JSON.parse(body);
    console.log('✏️ Updating watch:', watchId, request);
    
    const updateExpressions: string[] = ['updatedAt = :updatedAt'];
    const expressionAttributeValues: Record<string, any> = {
      ':updatedAt': new Date().toISOString(),
    };

    // ✅ ADDED - Support for priceThreshold update
    if (request.priceThreshold !== undefined) {
      if (typeof request.priceThreshold !== 'number' || request.priceThreshold <= 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid priceThreshold - must be a positive number' }),
        };
      }
      updateExpressions.push('priceThreshold = :priceThreshold');
      expressionAttributeValues[':priceThreshold'] = request.priceThreshold;
    }

    // ✅ ADDED - Support for departureDate update
    if (request.departureDate !== undefined) {
      updateExpressions.push('departureDate = :departureDate');
      expressionAttributeValues[':departureDate'] = request.departureDate;
    }

    // ✅ ADDED - Support for returnDate update
    if (request.returnDate !== undefined) {
      updateExpressions.push('returnDate = :returnDate');
      expressionAttributeValues[':returnDate'] = request.returnDate;
    }

    // Support for isActive toggle (pause/resume)
    if (request.isActive !== undefined) {
      updateExpressions.push('isActive = :isActive');
      expressionAttributeValues[':isActive'] = request.isActive ? 'true' : 'false';
    }

    if (updateExpressions.length === 1) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'No fields to update' }),
      };
    }

    const result = await docClient.send(new UpdateCommand({
      TableName: process.env.WATCHES_TABLE!,
      Key: { userId, watchId },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeValues: expressionAttributeValues,
      ConditionExpression: 'attribute_exists(userId)',
      ReturnValues: 'ALL_NEW',
    }));

    console.log('✅ Watch updated');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result.Attributes),
    };
  } catch (error: any) {
    console.error('❌ Error updating watch:', error);
    if (error.name === 'ConditionalCheckFailedException') {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Watch not found' }),
      };
    }
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to update watch',
        message: error.message
      }),
    };
  }
}

async function deleteWatch(userId: string, watchId: string, headers: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    console.log('🗑️ Deleting watch:', watchId);
    
    await docClient.send(new DeleteCommand({
      TableName: process.env.WATCHES_TABLE!,
      Key: { userId, watchId },
      ConditionExpression: 'attribute_exists(userId)',
    }));

    console.log('✅ Watch deleted');

    return {
      statusCode: 204,
      headers,
      body: '',
    };
  } catch (error: any) {
    console.error('❌ Error deleting watch:', error);
    if (error.name === 'ConditionalCheckFailedException') {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Watch not found' }),
      };
    }
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to delete watch',
        message: error.message
      }),
    };
  }
}

// ✅ ADDED - Price history endpoint
async function getPriceHistory(watchId: string, headers: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    console.log('📊 Getting price history for watch:', watchId);
    
    const result = await docClient.send(new QueryCommand({
      TableName: process.env.PRICE_SNAPSHOTS_TABLE!,
      KeyConditionExpression: 'watchId = :watchId',
      ExpressionAttributeValues: { ':watchId': watchId },
      ScanIndexForward: false, // Most recent first
      Limit: 50, // Last 50 price checks
    }));

    console.log('✅ Found', result.Items?.length || 0, 'price snapshots');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        snapshots: result.Items || [],
        count: result.Items?.length || 0
      }),
    };
  } catch (error) {
    console.error('❌ Error getting price history:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to retrieve price history',
        message: (error as Error).message
      }),
    };
  }
}
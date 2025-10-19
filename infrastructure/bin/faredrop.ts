#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { FareDropStack } from '../lib/faredrop-stack';

const app = new cdk.App();

new FareDropStack(app, 'FareDropStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  tags: {
    Project: 'faredrop-tracker',
    Environment: 'development',
    Course: 'CISE-UF',
    Program: 'AMEX-WiCSE',
  },
});
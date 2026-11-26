import { render } from 'preact';
import { App } from './app';
import { db } from './data/db';
import { isCloudConfigured } from './sync/client';
import { sync } from './sync/engine';
import { installOutbox } from './sync/outbox';
import { auth } from './sync/auth';
import './ui/tokens.css';
import './ui/styles.css';

if (isCloudConfigured) installOutbox(db, { onCapture: sync.notifyCapture });
void auth.start();
sync.start();
render(<App />, document.getElementById('app')!);

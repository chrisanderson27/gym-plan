import { render } from 'preact';
import { App } from './app';
import { auth } from './sync/auth';
import './ui/tokens.css';
import './ui/styles.css';

void auth.start();
render(<App />, document.getElementById('app')!);

import { render } from 'preact';
import { App } from './app';
import './ui/tokens.css';
import './ui/styles.css';

render(<App />, document.getElementById('app')!);

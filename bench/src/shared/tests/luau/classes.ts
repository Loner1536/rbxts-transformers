export class Vec2 {
    constructor(public x: number, public y: number) {}

    length(): number {
        return math.sqrt(this.x ** 2 + this.y ** 2);
    }

    add(other: Vec2): Vec2 {
        return new Vec2(this.x + other.x, this.y + other.y);
    }

    scale(factor: number): Vec2 {
        return new Vec2(this.x * factor, this.y * factor);
    }
}

export class Animal {
    name: string;
    health: number;

    constructor(name: string, health: number) {
        this.name = name;
        this.health = health;
    }

    isAlive(): boolean {
        return this.health > 0;
    }

    takeDamage(amount: number): void {
        this.health = math.max(0, this.health - amount);
    }
}

export class Dog extends Animal {
    breed: string;

    constructor(name: string, health: number, breed: string) {
        super(name, health);
        this.breed = breed;
    }

    describe(): string {
        return `${this.name} is a ${this.breed}`;
    }
}

// Class with static-like factory and computed state
export class Timer {
    private startTime: number;
    private elapsed: number = 0;
    private running: boolean = false;

    constructor(startTime: number) {
        this.startTime = startTime;
    }

    start(): void {
        this.running = true;
        this.startTime = os.clock();
    }

    stop(): number {
        if (this.running) {
            this.elapsed += os.clock() - this.startTime;
            this.running = false;
        }
        return this.elapsed;
    }

    reset(): void {
        this.elapsed = 0;
        this.running = false;
    }

    getElapsed(): number {
        if (this.running) {
            return this.elapsed + (os.clock() - this.startTime);
        }
        return this.elapsed;
    }
}
